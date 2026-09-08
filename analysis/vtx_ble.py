#!/usr/bin/env python3
"""Phone-free BLE control for the Vertex V2 device.

Written during the 2026-09-06 bench validation session so recordings could be
listed and uploaded without the companion app. The device advertises an open
GATT service (no pairing, bonding or encryption), so a plain central works.

Usage:
    python vtx_ble.py status          # one status packet, decoded
    python vtx_ble.py list            # files on the SD card
    python vtx_ble.py sync            # trigger the WiFi upload of all files
    python vtx_ble.py watch [SECS]    # stream status until interrupted

Protocol constants mirror firmware/imu_manager_v2/config.h and the packing in
ble_manager.cpp::sendStatus / CMD_LIST_FILES.
"""

import asyncio
import struct
import sys

from bleak import BleakClient, BleakScanner

DEVICE_NAME = "Vertex-V2"

SERVICE_UUID = "12345678-1234-5678-1234-56789abcdef0"
SENSOR_CHAR_UUID = "12345678-1234-5678-1234-56789abcdef1"  # status notifications
CONFIG_CHAR_UUID = "12345678-1234-5678-1234-56789abcdef2"  # commands
FILE_LIST_CHAR_UUID = "12345678-1234-5678-1234-56789abcdef3"

CMD_GET_STATUS = 0x01
CMD_LIST_FILES = 0x04
CMD_START_SYNC = 0x0C

# DeviceState in config.h. 3 = STATE_FAULT, added 2026-09-06.
STATE_NAMES = {0: "IDLE", 1: "RECORDING", 2: "UPLOADING", 3: "FAULT"}


def decode_status(b: bytes) -> dict:
    """Decode a status notification. Base packet is 15 bytes; recording adds 8,
    uploading adds 11."""
    if len(b) < 15:
        return {"error": f"short packet: {len(b)} bytes", "raw": b.hex()}

    state_raw = b[0]
    batt_mv, file_count, free_mb = struct.unpack_from("<HHH", b, 1)
    clock_synced = b[7]
    flags = b[8]
    ax, ay, az = struct.unpack_from("<hhh", b, 9)

    out = {
        # Report the raw value when unmapped rather than defaulting to a
        # healthy-looking state -- the app's `stateMap[x] || 'idle'` bug made a
        # faulted device read as idle.
        "state": STATE_NAMES.get(state_raw, f"UNKNOWN({state_raw})"),
        "battery_v": batt_mv / 1000.0,
        "file_count": file_count,
        "free_mb": free_mb,
        "clock_synced": bool(clock_synced),
        "sd_ok": bool(flags & 0x01),
        "imu_ok": bool(flags & 0x02),
        "space_low": bool(flags & 0x04),
        "space_critical": bool(flags & 0x08),
        "accel": (ax / 100.0, ay / 100.0, az / 100.0),
    }

    if state_raw == 1 and len(b) >= 23:
        secs, nbytes = struct.unpack_from("<II", b, 15)
        out["rec_secs"] = secs
        out["rec_bytes"] = nbytes
    elif state_raw == 2 and len(b) >= 26:
        cur, total, sent, tot, result = struct.unpack_from("<BBIIB", b, 15)
        out["upload"] = {
            "current_file": cur,
            "total_files": total,
            "bytes_sent": sent,
            "bytes_total": tot,
            "result": result,
        }
    return out


def decode_file_list(b: bytes) -> dict:
    """totalCount(1) + packedCount(1) + [name_len(1) + name + size(4) + synced(1)]..."""
    if len(b) < 2:
        return {"error": f"short packet: {len(b)} bytes", "raw": b.hex()}
    total, packed = b[0], b[1]
    files, off = [], 2
    for _ in range(packed):
        if off >= len(b):
            break
        name_len = b[off]
        off += 1
        name = b[off:off + name_len].decode("utf-8", "replace")
        off += name_len
        if off + 5 > len(b):
            break
        size = struct.unpack_from("<I", b, off)[0]
        off += 4
        synced = b[off]
        off += 1
        files.append({"name": name, "size": size, "synced": bool(synced)})
    return {"total_on_sd": total, "listed": packed, "files": files}


async def find_device(timeout: float = 10.0):
    print(f"Scanning for {DEVICE_NAME}...", flush=True)
    dev = await BleakScanner.find_device_by_name(DEVICE_NAME, timeout=timeout)
    if dev is None:
        raise SystemExit(
            f"Device '{DEVICE_NAME}' not found. Is it powered on and advertising?\n"
            "Note: BLE advertising stops during WiFi upload on some builds."
        )
    print(f"Found {dev.name} [{dev.address}]", flush=True)
    return dev


def fmt_status(s: dict) -> str:
    if "error" in s:
        return f"  !! {s['error']}  raw={s.get('raw')}"
    lines = [
        f"  state        : {s['state']}",
        f"  battery      : {s['battery_v']:.2f} V",
        f"  files on SD  : {s['file_count']}",
        f"  free space   : {s['free_mb']} MB",
        f"  clock synced : {s['clock_synced']}",
        f"  SD ok        : {s['sd_ok']}      IMU ok: {s['imu_ok']}",
        f"  space low    : {s['space_low']}   critical: {s['space_critical']}",
        f"  accel (m/s2) : {s['accel'][0]:+.2f} {s['accel'][1]:+.2f} {s['accel'][2]:+.2f}",
    ]
    if "rec_secs" in s:
        lines.append(f"  recording    : {s['rec_secs']} s, {s['rec_bytes']} bytes")
    if "upload" in s:
        u = s["upload"]
        lines.append(
            f"  upload       : file {u['current_file']}/{u['total_files']}, "
            f"{u['bytes_sent']}/{u['bytes_total']} bytes, result={u['result']}"
        )
    return "\n".join(lines)


async def run(cmd, arg):
    dev = await find_device()
    async with BleakClient(dev) as client:
        print("Connected.\n", flush=True)
        received = []

        def on_status(_, data: bytearray):
            received.append(bytes(data))

        def on_file_list(_, data: bytearray):
            received.append(bytes(data))

        if cmd in ("status", "watch"):
            await client.start_notify(SENSOR_CHAR_UUID, on_status)
            await client.write_gatt_char(CONFIG_CHAR_UUID, bytes([CMD_GET_STATUS]), response=True)

            if cmd == "status":
                await asyncio.sleep(2.0)
                if not received:
                    print("No status notification received.")
                else:
                    print("Status:")
                    print(fmt_status(decode_status(received[-1])))
            else:
                secs = float(arg) if arg else 60.0
                print(f"Watching for {secs:.0f}s (Ctrl-C to stop)...\n")
                seen = 0
                waited = 0.0
                while waited < secs:
                    await asyncio.sleep(1.0)
                    waited += 1.0
                    if len(received) > seen:
                        seen = len(received)
                        print(f"[t+{waited:5.0f}s]")
                        print(fmt_status(decode_status(received[-1])))
                        print()

        elif cmd == "list":
            await client.start_notify(FILE_LIST_CHAR_UUID, on_file_list)
            await client.write_gatt_char(CONFIG_CHAR_UUID, bytes([CMD_LIST_FILES]), response=True)
            await asyncio.sleep(3.0)
            if not received:
                print("No file-list notification received.")
            else:
                info = decode_file_list(received[-1])
                if "error" in info:
                    print(f"  !! {info['error']}")
                else:
                    print(f"{info['total_on_sd']} file(s) on SD, showing {info['listed']}:\n")
                    for f in info["files"]:
                        mark = "synced" if f["synced"] else "  --  "
                        print(f"  [{mark}] {f['name']:<28} {f['size']:>10,} B")

        elif cmd == "sync":
            await client.start_notify(SENSOR_CHAR_UUID, on_status)
            print("Triggering WiFi sync (device must be IDLE)...")
            await client.write_gatt_char(CONFIG_CHAR_UUID, bytes([CMD_START_SYNC]), response=True)
            # BLE may drop when the CPU clocks up for WiFi; report and exit
            # rather than treating a disconnect as failure.
            try:
                for _ in range(120):
                    await asyncio.sleep(1.0)
                    if received:
                        s = decode_status(received[-1])
                        if "upload" in s:
                            u = s["upload"]
                            print(
                                f"  file {u['current_file']}/{u['total_files']}  "
                                f"{u['bytes_sent']:,}/{u['bytes_total']:,} B",
                                flush=True,
                            )
                        if s.get("state") == "IDLE" and received[-1] is not received[0]:
                            print("\nDevice returned to IDLE — sync finished.")
                            break
            except Exception as e:  # noqa: BLE001 - report, don't mask
                print(f"\nConnection ended during sync: {e}")
                print("Check the serial monitor for [WiFi] progress.")
        else:
            raise SystemExit(f"Unknown command: {cmd}")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(1)
    cmd = sys.argv[1]
    arg = sys.argv[2] if len(sys.argv) > 2 else None
    try:
        asyncio.run(run(cmd, arg))
    except KeyboardInterrupt:
        print("\nInterrupted.")


if __name__ == "__main__":
    main()

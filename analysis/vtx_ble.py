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
    python vtx_ble.py log             # pull the diagnostic ring, decoded
    python vtx_ble.py log OUT.txt     # ...and save the raw lines to a file
    python vtx_ble.py loglevel D|I|W|E  # set the minimum level kept on SD
    python vtx_ble.py reset           # soft-reset the device (ESP.restart)
    python vtx_ble.py logclear        # erase the diagnostic ring

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
CMD_RESET = 0x0A
CMD_LOG_READ = 0x0F
CMD_LOG_SET_LEVEL = 0x10
CMD_LOG_STATUS = 0x11
CMD_LOG_CLEAR = 0x12

# Device -> host opcode on the file-list characteristic. See config.h and
# ble_manager.cpp::sendLogChunk.
NOTIFY_LOG_DATA = 0xF1
LOG_LEVEL_CHARS = {0: "DEBUG", 1: "INFO", 2: "WARN", 3: "ERROR"}
LOG_LEVEL_FROM_ARG = {"D": 0, "I": 1, "W": 2, "E": 3}

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


def decode_log_chunk(b: bytes) -> dict:
    """[0xF1][next_pos u64][gap u64][total u64][min_level u8][len u8][text]"""
    # Preamble is 27 bytes: opcode(1) + next_pos/gap/total (3 x u64 = 24)
    # + min_level(1) + len(1). Text follows at offset 27.
    if len(b) < 27:
        return {"error": f"short log packet: {len(b)} bytes", "raw": b.hex()}
    if b[0] != NOTIFY_LOG_DATA:
        return {"error": f"not a log packet: opcode 0x{b[0]:02X}", "raw": b.hex()}
    next_pos, gap, total = struct.unpack_from("<QQQ", b, 1)
    min_level = b[25]
    text_len = b[26]
    text = b[27:27 + text_len]
    if len(text) != text_len:
        return {"error": f"truncated: header says {text_len} text bytes, "
                         f"got {len(text)}", "raw": b.hex()}
    return {
        "next_pos": next_pos,
        "gap": gap,
        "total_written": total,
        "min_level": min_level,
        "text": text,
    }


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
        elif cmd == "log":
            # Pull the ring by repeated CMD_LOG_READ, walking the position the
            # device hands back. Readers hold a position against total_written,
            # not a raw offset, so this survives the writer wrapping underneath.
            chunks = []

            def on_log(_, data: bytearray):
                chunks.append(bytes(data))

            await client.start_notify(FILE_LIST_CHAR_UUID, on_log)

            # Ask for status first: it reports total_written without moving any
            # data, so we know up front how much there is to fetch.
            await client.write_gatt_char(
                CONFIG_CHAR_UUID, bytes([CMD_LOG_STATUS]), response=True)
            await asyncio.sleep(0.5)
            if not chunks:
                print("No log notification received. Is the firmware new enough?")
                return
            head = decode_log_chunk(chunks[-1])
            if "error" in head:
                print(f"  !! {head['error']}  raw={head.get('raw')}")
                return

            total = head["total_written"]
            level = LOG_LEVEL_CHARS.get(head["min_level"], head["min_level"])
            print(f"Ring: {total:,} bytes written, min level {level}\n")
            if total == 0:
                print("Log is empty — nothing has been written at the current "
                      "level yet.")
                return

            # Start from the oldest surviving byte. Position 0 is clamped up by
            # the device, which reports the resulting gap.
            pos = 0
            body = bytearray()
            total_gap = 0
            stalls = 0
            while True:
                chunks.clear()
                payload = bytes([CMD_LOG_READ]) + struct.pack("<Q", pos)
                await client.write_gatt_char(CONFIG_CHAR_UUID, payload, response=True)
                await asyncio.sleep(0.25)
                if not chunks:
                    stalls += 1
                    if stalls >= 3:
                        print(f"  !! no reply after {stalls} attempts at "
                              f"position {pos:,}; stopping")
                        break
                    continue
                stalls = 0

                r = decode_log_chunk(chunks[-1])
                if "error" in r:
                    print(f"  !! {r['error']}")
                    break
                if r["gap"]:
                    # Report the loss rather than stitching silently — the
                    # device flagged it, so the tool must surface it.
                    total_gap += r["gap"]
                    print(f"  !! GAP: {r['gap']:,} bytes overwritten before "
                          f"they were read")
                body += r["text"]

                # The device advances the position only over complete lines, so
                # an unchanged position means there is nothing further to read.
                if r["next_pos"] == pos and not r["text"]:
                    break
                pos = r["next_pos"]
                if pos >= r["total_written"]:
                    break

            text = body.decode("utf-8", "replace")
            lines = [ln for ln in text.split("\n") if ln.strip()]
            print(f"{len(lines)} line(s), {len(body):,} bytes"
                  + (f", {total_gap:,} bytes lost" if total_gap else "") + "\n")
            for ln in lines:
                print(f"  {ln}")

            if arg:
                with open(arg, "w") as fh:
                    fh.write(text)
                print(f"\nRaw lines written to {arg}")
                print(f"Decode with: python decode_log.py --help  "
                      f"(that tool reads a ring FILE; this output is already "
                      f"linearised)")

        elif cmd == "loglevel":
            if not arg or arg.upper()[0] not in LOG_LEVEL_FROM_ARG:
                raise SystemExit("Usage: vtx_ble.py loglevel D|I|W|E")
            lv = LOG_LEVEL_FROM_ARG[arg.upper()[0]]
            got = []
            await client.start_notify(FILE_LIST_CHAR_UUID,
                                      lambda _, d: got.append(bytes(d)))
            await client.write_gatt_char(
                CONFIG_CHAR_UUID, bytes([CMD_LOG_SET_LEVEL, lv]), response=True)
            await asyncio.sleep(0.6)
            if got:
                r = decode_log_chunk(got[-1])
                if "error" not in r:
                    print(f"Minimum SD log level is now "
                          f"{LOG_LEVEL_CHARS.get(r['min_level'], r['min_level'])} "
                          f"(persisted in NVS).")
                    return
            print("No confirmation received — check the serial monitor.")

        elif cmd == "logclear":
            got = []
            await client.start_notify(FILE_LIST_CHAR_UUID,
                                      lambda _, d: got.append(bytes(d)))
            await client.write_gatt_char(
                CONFIG_CHAR_UUID, bytes([CMD_LOG_CLEAR]), response=True)
            await asyncio.sleep(0.6)
            if got:
                r = decode_log_chunk(got[-1])
                if "error" not in r:
                    print(f"Ring cleared — total_written now {r['total_written']:,}")
                    return
            print("No confirmation received.")

        elif cmd == "reset":
            # CONFIG_CHAR is declared PROPERTY_WRITE only (no Write Without
            # Response), so response=False is silently dropped by the stack and
            # the device never sees the command. Must be response=True.
            #
            # The firmware acks, then delay(100) and ESP.restart(), so the write
            # itself succeeds and the link drops just after -- a disconnect
            # exception here means the reboot happened, not that it failed.
            print("Sending soft reset...")
            try:
                await client.write_gatt_char(
                    CONFIG_CHAR_UUID, bytes([CMD_RESET]), response=True)
                print("  command acknowledged")
            except Exception as e:  # noqa: BLE001 - a drop after the ack is fine
                print(f"  link dropped during/after the write: {e}")
            print("Device is rebooting. Re-advertises in a few seconds.")

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

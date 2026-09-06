#!/usr/bin/env python3
"""
Cross-validate the firmware's .vtx encoder against the packages/vtx-parser
decoder.

The firmware code (compiled by gen_vtx_fixture) writes a real .vtx file and
reports what it encoded. This script decodes the same bytes with the shipping
Python parser and asserts the two agree field by field.

This is a contract test, not a restatement of the spec: neither side is
allowed to define correctness on its own.

Usage: python3 crosscheck.py ./build/gen_vtx_fixture
"""

import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
PARSER_PATH = os.path.join(HERE, "../../packages/vtx-parser/python")

GREEN, RED, YELLOW, RESET = "\033[32m", "\033[31m", "\033[33m", "\033[0m"

failures = []


def check(label, actual, expected, tol=None):
    if tol is None:
        ok = actual == expected
    else:
        ok = abs(actual - expected) <= tol
    if ok:
        print(f"  {GREEN}PASS{RESET}  {label}")
    else:
        print(f"  {RED}FAIL{RESET}  {label}: encoded {expected!r}, decoded {actual!r}")
        failures.append(label)


def main():
    if len(sys.argv) < 2:
        print("usage: crosscheck.py <gen_vtx_fixture binary>", file=sys.stderr)
        return 2
    gen_bin = sys.argv[1]

    sys.path.insert(0, PARSER_PATH)
    try:
        from vtx_parser import decode_vtx
    except ImportError as e:
        print(f"{YELLOW}SKIP{RESET}  vtx-parser Python package not importable "
              f"from {PARSER_PATH}: {e}")
        print("      (unit suite via `make test` is unaffected)")
        return 0

    with tempfile.TemporaryDirectory() as tmp:
        vtx_path = os.path.join(tmp, "crosscheck.vtx")
        out = subprocess.run([gen_bin, vtx_path], capture_output=True, text=True)
        if out.returncode != 0:
            print(f"fixture generator failed:\n{out.stderr}", file=sys.stderr)
            return 1
        encoded = json.loads(out.stdout)

        with open(vtx_path, "rb") as f:
            raw = f.read()
        decoded = decode_vtx(raw)

    print("\n=== Firmware encode -> vtx-parser decode ===\n")

    h = decoded.header
    check("header.version_major", h.version_major, encoded["version_major"])
    check("header.version_minor", h.version_minor, encoded["version_minor"])
    check("header.metadata_length", h.metadata_length, encoded["metadata_length"])
    check("header.data_offset", h.data_offset, encoded["data_offset"])
    check("header.record_count", h.record_count, encoded["record_count"])
    check("header.sample_rate", h.sample_rate, encoded["sample_rate"], tol=1e-3)
    check("header.start_timestamp", h.start_timestamp, encoded["start_timestamp"])
    check("header.end_timestamp", h.end_timestamp, encoded["end_timestamp"])
    check("header.record_format", h.record_format, encoded["record_format"])
    check("header.compression", h.compression, encoded["compression"])

    # Metadata JSON must survive as parseable JSON with the fields the
    # cloud pipeline reads.
    meta = decoded.metadata or {}
    device = meta.get("device", {})
    check("metadata.device.name", device.get("name"), "Vertex-V2")
    check("metadata.device.firmwareVersion", device.get("firmwareVersion"), "2.0.0")
    check("metadata.session.position",
          meta.get("session", {}).get("position"), "Seatpost")

    # Every IMU record, field by field. float32 round trips exactly, so any
    # mismatch is a layout or byte-order error rather than precision.
    #
    # The firmware stores timestamp_ms as an offset from start_timestamp; the
    # decoder resolves it to an absolute unix time (decoder.py:385). Re-apply
    # that documented transform so the comparison is like for like — a bug in
    # either the stored offset or the header's start_timestamp still shows up.
    exp_records = encoded["records"]
    start_ts = encoded["start_timestamp"]
    check("record count decoded", len(decoded.records), len(exp_records))
    mismatched = 0
    for i, (r, e) in enumerate(zip(decoded.records, exp_records)):
        e = [start_ts + e[0]] + list(e[1:])
        got = [r.timestamp, r.accel_x, r.accel_y, r.accel_z,
               r.gyro_x, r.gyro_y, r.gyro_z]
        for k, (g, x) in enumerate(zip(got, e)):
            if abs(g - x) > 1e-5:
                if mismatched < 5:
                    names = ["timestamp", "accel_x", "accel_y", "accel_z",
                             "gyro_x", "gyro_y", "gyro_z"]
                    print(f"  {RED}FAIL{RESET}  record[{i}].{names[k]}: "
                          f"encoded {x}, decoded {g}")
                mismatched += 1
    if mismatched:
        failures.append(f"{mismatched} record field mismatches")
    else:
        print(f"  {GREEN}PASS{RESET}  all {len(exp_records)} records match "
              f"field-for-field")

    # Clock sync section (v1.2). Absence would mean the offset/count patch at
    # bytes 58/62 did not land.
    exp_syncs = encoded["sync_records"]
    sync_records = getattr(decoded, "sync_records", None) or []
    check("sync record count decoded", len(sync_records), len(exp_syncs))
    for i, (s, e) in enumerate(zip(sync_records, exp_syncs)):
        check(f"sync[{i}].t1_device_ms", s.t1_device_ms, e[0])
        check(f"sync[{i}].t4_device_ms", s.t4_device_ms, e[1])
        check(f"sync[{i}].t2_phone_unix_ms", s.t2_phone_unix_ms, e[2])
        check(f"sync[{i}].t3_phone_unix_ms", s.t3_phone_unix_ms, e[3])

    if failures:
        print(f"\n{RED}  {len(failures)} cross-check failure(s):{RESET}")
        for f in failures:
            print(f"    {f}")
        print()
        return 1
    print(f"\n  {GREEN}Firmware-encoded bytes decode correctly.{RESET}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())

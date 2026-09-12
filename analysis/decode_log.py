#!/usr/bin/env python3
"""Decode a retrieved Vertex diagnostic log ring into chronological lines.

The device writes a fixed-size ring file on the SD card, separate from the
`.vtx` recordings. This reads it, handles the wrap, drops the partial line at
the boundary, and emits records oldest-first.

Written after the 2026-09-07 ride produced 0 clock-sync records where ~156 were
due (notes/VALIDATION_PLAN.md §C3). The ride carried no evidence of whether the
device asked and got no answer or never asked at all; this is the tool that
reads the evidence the ring now keeps.

Usage:
    python decode_log.py vertex.log                 # all records
    python decode_log.py vertex.log --level WARN    # WARN and above
    python decode_log.py vertex.log --tag CLK       # one subsystem
    python decode_log.py vertex.log --summary       # counts by tag and level
    python decode_log.py vertex.log --raw           # no column formatting

Layout and byte order mirror firmware/imu_manager_v2/log_ring.h. The header is
authoritative for where the write head is; the file's own length is not, since
the region is written in place and grows to full size only on the first wrap.
"""

import argparse
import struct
import sys
from collections import Counter

MAGIC = b"VLOG"
FORMAT_VERSION = 1
HEADER_SIZE = 32

# Header field offsets -- see log_ring.h.
OFF_MAGIC = 0
OFF_VERSION = 4
OFF_WRITE_OFFSET = 8
OFF_TOTAL_WRITTEN = 12
OFF_RING_BYTES = 20

LEVELS = {"D": "DEBUG", "I": "INFO", "W": "WARN", "E": "ERROR"}
LEVEL_ORDER = {"DEBUG": 0, "INFO": 1, "WARN": 2, "ERROR": 3}


class LogHeader:
    def __init__(self, write_offset: int, total_written: int, ring_bytes: int):
        self.write_offset = write_offset
        self.total_written = total_written
        self.ring_bytes = ring_bytes

    @property
    def wrapped(self) -> bool:
        """True once the ring has overwritten at least one byte."""
        return self.total_written > self.ring_bytes

    @property
    def oldest_pos(self) -> int:
        """Position of the oldest surviving byte, in total_written space."""
        return max(0, self.total_written - self.ring_bytes)


def parse_header(blob: bytes) -> LogHeader:
    if len(blob) < HEADER_SIZE:
        raise ValueError(f"file shorter than a header: {len(blob)} bytes")

    magic = blob[OFF_MAGIC:OFF_MAGIC + 4]
    if magic != MAGIC:
        raise ValueError(f"bad magic {magic!r}, expected {MAGIC!r}")

    version = struct.unpack_from("<H", blob, OFF_VERSION)[0]
    if version != FORMAT_VERSION:
        raise ValueError(f"unsupported log format version {version}")

    write_offset = struct.unpack_from("<I", blob, OFF_WRITE_OFFSET)[0]
    total_written = struct.unpack_from("<Q", blob, OFF_TOTAL_WRITTEN)[0]
    ring_bytes = struct.unpack_from("<I", blob, OFF_RING_BYTES)[0]

    if ring_bytes == 0:
        raise ValueError("header declares a zero-length ring region")
    if write_offset >= ring_bytes:
        raise ValueError(
            f"write_offset {write_offset} outside a {ring_bytes}-byte region")
    # The firmware maintains write_offset == total_written % ring_bytes. A
    # mismatch means one of the two is corrupt, and every position derived from
    # the pair would be wrong -- report it rather than decoding confidently.
    if total_written % ring_bytes != write_offset:
        raise ValueError(
            f"inconsistent header: total_written {total_written} implies offset "
            f"{total_written % ring_bytes}, header says {write_offset}")

    return LogHeader(write_offset, total_written, ring_bytes)


def linearise(blob: bytes, hdr: LogHeader) -> bytes:
    """Return the ring region oldest-first.

    Before the first wrap the region is simply the first total_written bytes.
    After a wrap the oldest surviving byte sits at write_offset, so the region
    is rotated there.
    """
    region = blob[HEADER_SIZE:HEADER_SIZE + hdr.ring_bytes]

    if not hdr.wrapped:
        # Never wrapped: everything up to the write head, in order. The file may
        # be shorter than ring_bytes because the region is not preallocated.
        return region[:hdr.total_written]

    # Pad a short file so the rotation lands where the header says it does.
    if len(region) < hdr.ring_bytes:
        region = region + b"\x00" * (hdr.ring_bytes - len(region))
    return region[hdr.write_offset:] + region[:hdr.write_offset]


def decode_records(data: bytes, wrapped: bool):
    """Yield (millis, level, tag, message) oldest-first.

    Two fragments are dropped, both by construction rather than heuristically:
    the partial line at the start (only when the ring has wrapped -- its head
    was overwritten), and any unterminated tail at the write head. Wrap padding
    is a run of newlines, which splits into empty strings that fall out here.
    """
    lines = data.split(b"\n")

    # A wrapped ring begins mid-line: the first element is the tail of a record
    # whose head was overwritten. Never drop it on an unwrapped ring, where the
    # first line is genuinely the first line.
    if wrapped and lines:
        lines = lines[1:]
    # The final element is whatever follows the last newline: empty when the
    # ring ends on a terminator, otherwise a partial line at the write head.
    if lines:
        lines = lines[:-1]

    for raw in lines:
        if not raw:
            continue  # wrap padding, or a blank record
        try:
            text = raw.decode("utf-8", errors="replace")
        except Exception:
            continue

        parts = text.split(" ", 3)
        if len(parts) < 4:
            yield None, "?", "?", f"<unparseable: {text!r}>"
            continue

        ms_str, lvl_char, tag, msg = parts
        try:
            millis = int(ms_str)
        except ValueError:
            yield None, "?", "?", f"<unparseable: {text!r}>"
            continue

        # An unrecognised severity is reported, never bucketed as DEBUG: that
        # would let a corrupt line read as a valid low-severity one.
        level = LEVELS.get(lvl_char, f"UNKNOWN({lvl_char})")
        yield millis, level, tag, msg


def format_uptime(millis: int) -> str:
    """millis() as h:mm:ss.mmm. The device's own time base, matching the
    timestamps on IMU samples, so a log line can be placed against the sample
    stream directly."""
    if millis is None:
        return "?"
    s, ms = divmod(millis, 1000)
    m, s = divmod(s, 60)
    h, m = divmod(m, 60)
    return f"{h}:{m:02d}:{s:02d}.{ms:03d}"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("path", help="retrieved log ring file")
    ap.add_argument("--level", choices=sorted(LEVEL_ORDER, key=LEVEL_ORDER.get),
                    help="minimum severity to print")
    ap.add_argument("--tag", help="only this subsystem (CLK, BLE, SD, REC, ...)")
    ap.add_argument("--summary", action="store_true",
                    help="counts by tag and level instead of the lines")
    ap.add_argument("--raw", action="store_true",
                    help="emit stored lines verbatim, no column formatting")
    args = ap.parse_args()

    try:
        with open(args.path, "rb") as fh:
            blob = fh.read()
    except OSError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1

    try:
        hdr = parse_header(blob)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1

    records = list(decode_records(linearise(blob, hdr), hdr.wrapped))

    # Report the loss explicitly. A wrapped ring has discarded its oldest bytes,
    # and presenting what survives as a complete history would be the same
    # silent-resync mistake the BLE reader is built to avoid.
    print(f"# {args.path}: {hdr.total_written:,} bytes written, "
          f"{hdr.ring_bytes:,}-byte ring, head at {hdr.write_offset:,}",
          file=sys.stderr)
    if hdr.wrapped:
        lost = hdr.total_written - hdr.ring_bytes
        print(f"# WRAPPED: {lost:,} bytes overwritten and unrecoverable "
              f"(surviving history starts at position {hdr.oldest_pos:,})",
              file=sys.stderr)
    print(f"# {len(records):,} records decoded", file=sys.stderr)

    if args.level:
        floor = LEVEL_ORDER[args.level]
        records = [r for r in records
                   if LEVEL_ORDER.get(r[1], 99) >= floor]
    if args.tag:
        records = [r for r in records if r[2] == args.tag]

    if args.summary:
        by_tag, by_level = Counter(), Counter()
        for _, level, tag, _ in records:
            by_tag[tag] += 1
            by_level[level] += 1
        print("\nBy level:")
        for level, n in sorted(by_level.items(),
                               key=lambda kv: -LEVEL_ORDER.get(kv[0], 99)):
            print(f"  {level:8s} {n:7,d}")
        print("\nBy tag:")
        for tag, n in by_tag.most_common():
            print(f"  {tag:8s} {n:7,d}")
        return 0

    for millis, level, tag, msg in records:
        if args.raw:
            print(f"{millis} {level[0] if level != '?' else '?'} {tag} {msg}")
        else:
            print(f"{format_uptime(millis):>12s}  {level:5s}  {tag:5s}  {msg}")

    return 0


if __name__ == "__main__":
    sys.exit(main())

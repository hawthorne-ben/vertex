#!/usr/bin/env python3
"""
C++ practice drills against the real firmware, verified by the real tests.

Two kinds:

  write  — a function body is removed and replaced with a comment describing
           exactly what it must do. You write the C++ by hand. This is the
           one that refreshes your chops.

  fix    — a one-line defect is injected. Tests go red. You read the failure
           and find it. This is debug reasoning, not typing.

Usage:
    python3 drill.py list
    python3 drill.py start write-1      # stub out the function, run tests
    python3 drill.py check              # rebuild and run
    python3 drill.py answer             # show the original implementation
    python3 drill.py reset              # restore everything

Only ever touches a working copy; originals are restored from a pristine
snapshot taken on first use, so a botched drill can never damage the firmware.
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TEST = HERE.parent
FW = TEST.parent / "imu_manager_v2"
SNAP = HERE / ".pristine"
STATE = HERE / ".active"


# Each drill names a file, a function, and the comment block that replaces its
# body. The comment has to be specific enough that the exercise is "write this
# C++", not "guess what I wanted".
WRITE_DRILLS = {
    "write-1": {
        "file": "log_ring.h",
        "func": "logSkipPartialLine",
        "why": "Loop over a buffer, return an index. The simplest one — warm up here.",
        "stub": """  // WRITE THIS.
  //
  // Scan `buf` (length `len`) forward for the first '\\n'.
  //
  //   - If found at index i, return i + 1 — the caller discards the
  //     fragment AND its terminating newline.
  //   - If there is no newline anywhere in the window, return `len`:
  //     the whole window is one unterminated fragment.
  //
  // Types matter: the loop counter should be uint32_t to match `len`.
  return 0;""",
    },
    "write-2": {
        "file": "log_ring.h",
        "func": "logTrimToLastLine",
        "why": "Reverse iteration with an unsigned counter — the classic trap.",
        "stub": """  // WRITE THIS.
  //
  // The complement of logSkipPartialLine(). Find the LAST '\\n' in `buf`
  // and return the length to keep, including that newline.
  //
  //   - Window ends mid-line -> return length up to and including the
  //     last newline.
  //   - Window ends exactly on a newline -> return `len` unchanged.
  //   - No newline at all -> return 0, meaning no complete line yet.
  //
  // THE TRAP: iterating backwards with a uint32_t. `for (uint32_t i = len-1;
  // i >= 0; i--)` never terminates — an unsigned value is always >= 0, so it
  // wraps to UINT32_MAX and reads out of bounds. Loop on `i > 0` and index
  // with `buf[i - 1]`.
  return 0;""",
    },
    "write-3": {
        "file": "log_ring.h",
        "func": "logPlanRead",
        "why": "Unsigned subtraction and branch coverage. The most interview-like.",
        "stub": """  // WRITE THIS.
  //
  // Decide what a reader at `readerPos` can read, given the writer has
  // written `totalWritten` bytes total into a ring of `ringBytes`.
  //
  // Fill in the LogReadPlan `r` (fields: fromPos, available, gapBytes,
  // lapped). Start with gapBytes = 0 and lapped = false.
  //
  // Three cases:
  //
  //   1. readerPos >= totalWritten — the reader is ahead of the writer
  //      (log was reset, or the position came from a different file).
  //      Treat as fully caught up: fromPos = totalWritten, available = 0.
  //      Return early. Do NOT compute totalWritten - readerPos here; it
  //      underflows to something near 2^64.
  //
  //   2. The reader is behind by more than one full ring. Data it never
  //      saw has been overwritten. Set lapped = true, fromPos to one ring
  //      back from the write head, gapBytes to how much was missed, and
  //      available = ringBytes.
  //
  //   3. Otherwise the reader is inside the ring and loses nothing:
  //      fromPos = readerPos, available = the distance behind.
  //
  // Watch the narrowing cast: `available` is uint32_t but the distance
  // behind is computed in uint64_t.
  LogReadPlan r;
  r.fromPos = 0; r.available = 0; r.gapBytes = 0; r.lapped = false;
  return r;""",
    },
    "write-4": {
        "file": "log_ring.h",
        "func": "logPlaceLine",
        "why": "Struct return, wrap arithmetic, one nasty boundary. Hardest of the four.",
        "stub": """  // WRITE THIS.
  //
  // Decide where a log line of `lineLen` bytes goes in a ring of
  // `ringBytes`, with the write head at `writeOffset`.
  //
  // The record needs lineLen + 1 bytes (the line plus its newline).
  // Space to the physical end of the ring is ringBytes - writeOffset.
  //
  // Fill LogPlacement p (padBytes, lineStart, nextOffset, advance):
  //
  //   FITS (needed <= space):
  //     padBytes = 0, lineStart = writeOffset, advance = needed,
  //     nextOffset = writeOffset + needed.
  //     BOUNDARY: if nextOffset lands exactly on ringBytes, it must wrap
  //     to 0 — an offset equal to the size is out of range.
  //
  //   DOES NOT FIT:
  //     Pad the tail with newlines and restart the line at 0.
  //     padBytes = space, lineStart = 0, nextOffset = needed.
  //     advance = space + needed — the padding counts as consumed
  //     capacity, because if it did not, the reader's position
  //     arithmetic would drift from the writer's on every wrap.
  LogPlacement p;
  p.padBytes = 0; p.lineStart = 0; p.nextOffset = 0; p.advance = 0;
  return p;""",
    },
}

# One-line defects. Kept few and realistic — each is a mistake a person makes.
FIX_DRILLS = {
    "fix-1": {
        "file": "log_ring.h",
        "why": "Off-by-one at a boundary.",
        "old": "  if (needed <= space) {",
        "new": "  if (needed < space) {",
    },
    "fix-2": {
        "file": "log_ring.h",
        "why": "A comparison that looks right and is not.",
        "old": "  if (behind > ringBytes) {",
        "new": "  if (behind >= ringBytes) {",
    },
    "fix-3": {
        "file": "log_ring.h",
        "why": "Exact-fit wrap dropped. Subtle: most tests still pass.",
        "old": "    if (p.nextOffset == ringBytes) p.nextOffset = 0;  // exact fit wraps to 0",
        "new": "    // (wrap check removed)",
    },
}


TRACKED = ["log_ring.h", "vtx_format.h", "config.h"]


def snapshot() -> None:
    """Refresh the pristine copy — but only when no drill is active.

    The snapshot is what `reset` restores from, so it must track real edits to
    the firmware. Taking it once and never again means any legitimate change
    made between drills gets silently reverted by the next reset. (That is not
    hypothetical: it ate a pass of documentation on log_ring.h.)

    Refreshing while a drill IS active would be the opposite failure — it would
    bake the stub in as the new baseline and destroy the original. So: refresh
    when clean, never when dirty.
    """
    SNAP.mkdir(parents=True, exist_ok=True)
    if STATE.exists():
        return  # a drill is applied; the working tree is not a valid baseline
    for f in TRACKED:
        shutil.copy2(FW / f, SNAP / f)


def restore() -> None:
    for f in SNAP.glob("*"):
        # copy, then stamp NOW. copy2 would preserve the snapshot's old mtime,
        # which can leave the restored header older than the built binary —
        # make then skips the rebuild and a correct answer still shows red.
        shutil.copy(f, FW / f.name)
        (FW / f.name).touch()
    if STATE.exists():
        STATE.unlink()


def body_span(text: str, func: str) -> tuple[int, int]:
    """Find the brace-matched body of `func`. Returns (start, end) offsets."""
    m = re.search(rf"\b{re.escape(func)}\s*\([^)]*\)\s*\{{", text, re.S)
    if not m:
        sys.exit(f"could not locate {func}()")
    start = m.end()
    depth = 1
    i = start
    while i < len(text) and depth:
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
        i += 1
    return start, i - 1


def run_tests() -> bool:
    # Always rebuild from scratch. make compares mtimes at one-second
    # resolution, so a header edited in the same second as the last build looks
    # unchanged and the stale binary runs — which would show a correct answer
    # as failing, or a stubbed function as passing. Both are worse than the two
    # seconds a clean build costs.
    subprocess.run(["make", "clean"], cwd=TEST, capture_output=True)
    r = subprocess.run(["make", "test"], cwd=TEST, capture_output=True,
                       text=True)
    out = r.stdout + r.stderr
    fails = [l for l in out.splitlines() if "FAIL" in l]
    nums = re.findall(r"(\d+)/(\d+) passed", out)
    passed = sum(int(a) for a, _ in nums)
    total = sum(int(b) for _, b in nums)

    if r.returncode != 0 and not nums:
        print("\n  BUILD FAILED\n")
        for line in out.splitlines():
            if "error" in line.lower():
                print("   ", line.strip())
        print()
        return False

    if fails:
        print(f"\n  {passed}/{total} passing — {len(fails)} failing:\n")
        for f in fails[:12]:
            print("   ", re.sub(r"\x1b\[[0-9;]*m", "", f).strip())
        print()
        return False

    print(f"\n  {passed}/{total} passing. Done.\n")
    return True


def cmd_list() -> None:
    print("\n  WRITE — function removed, you implement it\n")
    for k, d in WRITE_DRILLS.items():
        print(f"    {k:9} {d['func']:22} {d['why']}")
    print("\n  FIX — defect injected, you find it\n")
    for k, d in FIX_DRILLS.items():
        print(f"    {k:9} {'':22} {d['why']}")
    print(f"\n  start with: python3 drill.py start write-1\n")


def cmd_start(name: str) -> None:
    snapshot()
    restore()

    if name in WRITE_DRILLS:
        d = WRITE_DRILLS[name]
        path = FW / d["file"]
        text = path.read_text()
        s, e = body_span(text, d["func"])
        path.write_text(text[:s] + "\n" + d["stub"] + "\n" + text[e:])
        STATE.write_text(name)
        print(f"\n  {name} — {d['file']}::{d['func']}()")
        print(f"  {d['why']}")
        print(f"\n  Open:  firmware/imu_manager_v2/{d['file']}")
        print(f"  Then:  python3 drill.py check\n")
        run_tests()

    elif name in FIX_DRILLS:
        d = FIX_DRILLS[name]
        path = FW / d["file"]
        text = path.read_text()
        if d["old"] not in text:
            sys.exit(f"anchor not found — firmware changed? {d['old'][:40]}")
        path.write_text(text.replace(d["old"], d["new"], 1))
        STATE.write_text(name)
        print(f"\n  {name} — a defect is now in {d['file']}. Find it.")
        print(f"  No peeking at git diff.\n")
        run_tests()
    else:
        sys.exit(f"unknown drill: {name}")


def cmd_answer() -> None:
    if not STATE.exists():
        sys.exit("no drill active")
    name = STATE.read_text().strip()
    if name in WRITE_DRILLS:
        d = WRITE_DRILLS[name]
        orig = (SNAP / d["file"]).read_text()
        s, e = body_span(orig, d["func"])
        print(f"\n  {d['func']}() as written:\n")
        for line in orig[s:e].strip("\n").splitlines():
            print("   ", line)
        print()
    else:
        d = FIX_DRILLS[name]
        print(f"\n  The injected line was:\n")
        print(f"    - {d['old'].strip()}")
        print(f"    + {d['new'].strip()}\n")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["list", "start", "check", "answer", "reset"])
    ap.add_argument("name", nargs="?")
    a = ap.parse_args()

    if a.cmd == "list":
        cmd_list()
    elif a.cmd == "start":
        if not a.name:
            sys.exit("which drill? python3 drill.py list")
        cmd_start(a.name)
    elif a.cmd == "check":
        run_tests()
    elif a.cmd == "answer":
        cmd_answer()
    elif a.cmd == "reset":
        snapshot()
        restore()
        print("\n  restored\n")
        run_tests()


if __name__ == "__main__":
    main()

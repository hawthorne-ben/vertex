#!/usr/bin/env python3
"""
Print the presenter cues from notes/presentation-script.md, in slide order.

The script file is authored as one document so the cues cannot drift from the
prose they summarise. This pulls just the `**Cues:**` blocks out for pasting
into Keynote / Google Slides presenter notes.

    ../venv-analysis/bin/python cues.py          # all slides, boxed
    ../venv-analysis/bin/python cues.py --plain  # no rules, for pasting
    ../venv-analysis/bin/python cues.py 3d 5b    # only matching sections

Matching is a case-insensitive substring test against the section heading, so
"3d", "clock", and "do-over" all work.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "notes/presentation-script.md"

# A heading is any ## or ### line; a cue block runs from "**Cues:**" to the
# next blank-line-terminated non-list line.
_HEADING = re.compile(r"^(#{2,3})\s+(.*?)\s*$")
_CUES = re.compile(r"^\*\*Cues:\*\*\s*$")


def parse(text: str) -> list[tuple[str, list[str]]]:
    """Return [(heading, [cue, ...]), ...] in document order."""
    out: list[tuple[str, list[str]]] = []
    heading = ""
    cues: list[str] = []
    collecting = False

    for line in text.splitlines():
        m = _HEADING.match(line)
        if m:
            if cues:
                out.append((heading, cues))
                cues = []
            heading = m.group(2)
            collecting = False
            continue

        if _CUES.match(line):
            collecting = True
            continue

        if collecting:
            if line.startswith("- "):
                cues.append(line[2:].strip())
            elif line.startswith("  ") and cues:
                # Continuation of the previous bullet.
                cues[-1] += " " + line.strip()
            elif line.strip() == "":
                continue
            else:
                collecting = False

    if cues:
        out.append((heading, cues))
    return out


def strip_md(s: str) -> str:
    """Drop bold/code markers — presenter notes render as plain text."""
    s = re.sub(r"\*\*(.+?)\*\*", r"\1", s)
    s = re.sub(r"\*(.+?)\*", r"\1", s)
    return s.replace("`", "")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("filter", nargs="*",
                    help="only sections whose heading contains one of these")
    ap.add_argument("--plain", action="store_true",
                    help="no rules or bullets, for pasting into slide notes")
    args = ap.parse_args()

    if not SCRIPT.exists():
        sys.exit(f"not found: {SCRIPT}")

    sections = parse(SCRIPT.read_text())
    if args.filter:
        want = [f.lower() for f in args.filter]
        sections = [(h, c) for h, c in sections
                    if any(w in h.lower() for w in want)]
        if not sections:
            sys.exit(f"no section matched: {' '.join(args.filter)}")

    total = 0
    for heading, cues in sections:
        total += len(cues)
        if args.plain:
            print(strip_md(heading))
            for c in cues:
                print(f"  {strip_md(c)}")
            print()
        else:
            print(f"\n\033[1m── {strip_md(heading)} ──\033[0m")
            for c in cues:
                print(f"  • {strip_md(c)}")

    if not args.plain:
        print(f"\n  {len(sections)} sections, {total} cues\n")


if __name__ == "__main__":
    main()

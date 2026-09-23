"""
The .vtx file header and file structure — appendix.

Slide 6a shows the 28-byte record. This is the part that actually carries the
design decisions: a fixed 64-byte header, a variable JSON metadata block, and
three optional sections whose offsets live in the header.

WHY THE HEADER IS THE INTERESTING HALF
--------------------------------------
Three things fall out of it, and each is a decision worth defending:

1.  `record_format` is a bitmask, not an enum. The parser derives record width
    from it, so one parser reads V1's 56-byte 9-DoF records and V2's 28-byte
    6-DoF records with the same arithmetic. That is what let the format
    survive a hardware generation change.

2.  `record_count` and `end_timestamp` are written as zero and patched — every
    1,040 records while recording, and again on close. That is the crash
    tolerance on 6b: the two fields a reader needs to trust the file are
    re-asserted on a cadence, so an ungraceful termination still leaves a
    header that describes the file.

3.  Offsets for the GPS and sync sections are zero when those sections are
    absent. A file with no clock-sync records reads back as "no sync stream"
    rather than as a corrupt offset, which is what makes the optional sections
    actually optional.

Everything here is read from firmware/imu_manager_v2/vtx_format.h and
config.h — the offsets are the ones the firmware writes, not a transcription.

Run:
    cd analysis && ../venv-analysis/bin/python vtx_header.py
"""

from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))

from plot_style import C, save, setup  # noqa: E402

import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import Rectangle  # noqa: E402

OUT = "99_vtx_header"

# (offset, size, name, type, note) — from vtx_format.h VTX_OFF_* defines.
FIELDS = [
    (0,  4, "magic",           "char[4]", '"VTX\\0"'),
    (4,  2, "version_major",   "uint16",  "1"),
    (6,  2, "version_minor",   "uint16",  "2"),
    (8,  4, "metadata_length", "uint32",  "JSON block length"),
    (12, 4, "data_offset",     "uint32",  "64 + metadata_length"),
    (16, 8, "record_count",    "uint64",  "PATCHED every 1,040 records"),
    (24, 4, "sample_rate",     "float32", "104.0"),
    (28, 8, "start_timestamp", "int64",   "epoch ms, set at open"),
    (36, 8, "end_timestamp",   "int64",   "PATCHED every 1,040 records"),
    (44, 1, "record_format",   "uint8",   "bitmask, 0x03 = accel | gyro"),
    (45, 1, "compression",     "uint8",   "0 = none"),
    (46, 8, "gps_record_count", "uint64", "v1.1+, 0 on this hardware"),
    (54, 4, "gps_data_offset", "uint32",  "v1.1+, 0 on this hardware"),
    (58, 4, "sync_data_offset", "uint32", "v1.2+, 0 if no sync records"),
    (62, 2, "sync_record_count", "uint16", "v1.2+, clock-sync exchanges"),
]

# File sections, drawn to relative scale.
SECTIONS = [
    ("64 B header", 0.055, C.PRIMARY),
    ("JSON metadata", 0.075, C.SECONDARY),
    ("IMU records, 28 B each", 0.72, C.PRIMARY),
    ("sync records, 24 B each", 0.15, C.ORANGE),
]


def draw_sections(ax) -> None:
    """Top strip: the file, end to end."""
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")

    x = 0.0
    # The two leading sections are narrow and adjacent, so their labels
    # collide if both hang straight down. Stagger them onto two rows.
    below_y = [0.30, 0.04]
    below_i = 0
    for label, frac, color in SECTIONS:
        ax.add_patch(Rectangle((x, 0.42), frac, 0.34, facecolor=color,
                               edgecolor="white", lw=2.0, zorder=3))
        if frac >= 0.16:
            ax.text(x + frac / 2, 0.59, label, ha="center", va="center",
                    fontsize=10.5, color="white", weight="600", zorder=4)
        else:
            y = below_y[below_i % len(below_y)]
            below_i += 1
            ax.plot([x + frac / 2, x + frac / 2], [0.40, y + 0.10],
                    color=C.TEXT_3, lw=0.9, zorder=2)
            ax.text(x + frac / 2, y, label, ha="center", va="top",
                    fontsize=9.5, color=C.TEXT_2, zorder=4)
        x += frac

    ax.text(0, 0.88, "One file, four sections", ha="left", va="center",
            fontsize=11.5, weight="600", color=C.INK)
    ax.text(1.0, 0.88,
            "sync section is absent when no phone was connected",
            ha="right", va="center", fontsize=9.5, color=C.TEXT_3)


def draw_header_table(ax) -> None:
    """Bottom: the 64-byte header, field by field."""
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")

    n = len(FIELDS)
    top, bottom = 0.93, 0.02
    row_h = (top - bottom) / (n + 1)

    cols = [0.0, 0.075, 0.155, 0.40, 0.55]
    heads = ["Off", "Size", "Field", "Type", "Value"]
    y = top
    for x, h in zip(cols, heads):
        ax.text(x, y, h, ha="left", va="center", fontsize=10,
                weight="600", color=C.INK)
    y -= row_h * 0.55
    ax.plot([0, 1], [y, y], color=C.BORDER, lw=1.1)
    y -= row_h * 0.45

    for i, (off, size, name, typ, note) in enumerate(FIELDS):
        if i % 2 == 0:
            ax.add_patch(Rectangle((0, y - row_h * 0.5), 1, row_h,
                                   facecolor=C.BORDER, alpha=0.22, lw=0,
                                   zorder=0))
        patched = note.startswith("PATCHED")
        color = C.CONTRAST if patched else C.INK
        ax.text(cols[0], y, str(off), ha="left", va="center", fontsize=9.5,
                family="monospace", color=C.TEXT_2, zorder=3)
        ax.text(cols[1], y, str(size), ha="left", va="center", fontsize=9.5,
                family="monospace", color=C.TEXT_2, zorder=3)
        ax.text(cols[2], y, name, ha="left", va="center", fontsize=10,
                family="monospace", color=color, zorder=3)
        ax.text(cols[3], y, typ, ha="left", va="center", fontsize=9.5,
                family="monospace", color=C.TEXT_2, zorder=3)
        ax.text(cols[4], y, note, ha="left", va="center", fontsize=10,
                color=color, weight="600" if patched else None, zorder=3)
        y -= row_h


def main() -> None:
    setup()

    fig = plt.figure(figsize=(11.5, 7.6), layout="none")
    # The section strip needs vertical room for its staggered labels; the
    # table starts just below them rather than leaving a band of white.
    ax_sec = fig.add_axes([0.045, 0.815, 0.925, 0.115])
    ax_tab = fig.add_axes([0.045, 0.115, 0.925, 0.680])

    draw_sections(ax_sec)
    draw_header_table(ax_tab)

    fig.text(0.045, 0.975, "The .vtx header — 64 bytes, fixed",
             ha="left", va="top", fontsize=15.5, weight="600", color=C.INK)

    # One text block, not two — two separately-anchored blocks overlap as soon
    # as the first one wraps to a second line.
    fig.text(0.045, 0.082,
             "record_format is a bitmask, not an enum: accel 0x01, gyro 0x02, "
             "mag 0x04, quaternion 0x08. The parser derives record width from "
             "it, so one\nparser reads V1's 56-byte 9-DoF records and V2's "
             "28-byte 6-DoF records with the same arithmetic.\n"
             "Little-endian throughout. Zero offsets mean the section is "
             "absent, not corrupt. Two fields are re-asserted on a cadence — "
             "see the power-cut slide.",
             ha="left", va="top", fontsize=10, color=C.TEXT_2,
             linespacing=1.7)

    save(fig, OUT)

    total = sum(s for _, s, _, _, _ in FIELDS)
    print(f"\n  {len(FIELDS)} fields, {total} bytes described, "
          f"64-byte header ({64 - total} reserved)\n")


if __name__ == "__main__":
    main()

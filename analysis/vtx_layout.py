"""
.vtx byte layout and size comparison — slide 6a.

Top     the 28-byte record as a byte map: one uint32 timestamp and six
        float32s, drawn to scale so the proportions are visible.
Bottom  measured size against the same data as CSV, from a real 4 h file.

THE SIZE NUMBER, AND WHY IT IS NOT THE ONE IN THE OLD SPEC
----------------------------------------------------------
The format spec quotes "78% smaller", which assumes a ~130-byte CSV row — that
is a 9-DoF row carrying magnetometer and quaternion fields, matching V1's
56-byte record. V2 records 6-DoF in 28 bytes, and the equivalent CSV row
measured from real values is ~61 bytes. So the honest figure for the format as
it ships today is **54%**, not 78%.

Both are true of different configurations. Quoting 78% beside a 28-byte record
would be comparing a V1-sized CSV against a V2-sized binary, which is the kind
of thing this audience checks.

Everything below is measured from the file named in SRC, not estimated.

Run:
    cd analysis && ../venv-analysis/bin/python vtx_layout.py
"""

from __future__ import annotations

import statistics
import sys
from pathlib import Path

import numpy as np

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent / "packages/vtx-parser/python"))
sys.path.insert(0, str(_HERE))

from plot_style import C, save, setup  # noqa: E402
from vtx_parser import decode_vtx  # noqa: E402

import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import Rectangle  # noqa: E402

SRC = "data/sample-recordings/9_13_2026_34988967.vtx"

# The v1.2 record as the firmware writes it, in order. (label, bytes, colour)
FIELDS = [
    ("timestamp", 4, C.SECONDARY),
    ("accel_x", 4, C.PRIMARY),
    ("accel_y", 4, C.PRIMARY),
    ("accel_z", 4, C.PRIMARY),
    ("gyro_x", 4, C.ORANGE),
    ("gyro_y", 4, C.ORANGE),
    ("gyro_z", 4, C.ORANGE),
]

OUT = "06a_vtx_layout"


def csv_row_bytes(records, n: int = 5000) -> float:
    """Mean bytes of the equivalent CSV row, rendered from real values."""
    lens = []
    for r in records[:n]:
        row = (f"{r.timestamp},{r.accel_x:.4f},{r.accel_y:.4f},"
               f"{r.accel_z:.4f},{r.gyro_x:.4f},{r.gyro_y:.4f},"
               f"{r.gyro_z:.4f}\n")
        lens.append(len(row))
    return statistics.mean(lens)


def draw_record_map(ax, rec_bytes: int) -> None:
    """Top panel: the record, drawn to scale across the full width."""
    ax.set_xlim(0, rec_bytes)
    ax.set_ylim(0, 2.6)
    ax.axis("off")

    y, h = 1.05, 0.78
    off = 0
    for label, size, color in FIELDS:
        ax.add_patch(Rectangle((off, y), size, h, facecolor=color,
                               edgecolor="white", lw=2.0, zorder=3))
        ax.text(off + size / 2, y + h / 2, label.replace("_", "\n"),
                ha="center", va="center", fontsize=9.5, color="white",
                weight="600", zorder=4, linespacing=1.2)
        # Byte offset under each field.
        ax.text(off, y - 0.14, str(off), ha="center", va="top",
                fontsize=9.5, color=C.TEXT_2, family="monospace")
        off += size
    ax.text(rec_bytes, y - 0.14, str(rec_bytes), ha="center", va="top",
            fontsize=9.5, color=C.TEXT_2, family="monospace")

    # Type row above.
    ax.text(2, y + h + 0.16, "uint32", ha="center", va="bottom",
            fontsize=10, color=C.TEXT_2, family="monospace")
    ax.text(16, y + h + 0.16, "6 x float32", ha="center", va="bottom",
            fontsize=10, color=C.TEXT_2, family="monospace")

    ax.text(rec_bytes / 2, y - 0.62,
            f"{rec_bytes} bytes, fixed width — so record i lives at "
            f"data_offset + i x {rec_bytes}",
            ha="center", va="top", fontsize=11.5, color=C.INK)
    ax.text(rec_bytes / 2, y - 1.02,
            "No scan, no index, no delimiter search. Seek straight to any "
            "sample in a four-hour file.",
            ha="center", va="top", fontsize=10.5, color=C.TEXT_2)


def main() -> None:
    setup()

    raw = Path(SRC).read_bytes()
    vtx = decode_vtx(raw)
    h = vtx.header
    n = int(h.record_count)
    rec_bytes = int(round((len(raw) - h.data_offset) / n))

    csv_row = csv_row_bytes(vtx.records)
    csv_total = csv_row * n
    vtx_total = len(raw)
    reduction = 1.0 - vtx_total / csv_total
    hours = (h.end_timestamp - h.start_timestamp) / 3.6e6

    fig, (ax_map, ax_bar) = plt.subplots(
        2, 1, figsize=(11.0, 6.0),
        gridspec_kw={"height_ratios": [1.0, 0.85], "hspace": 0.30},
        layout="none",
    )

    draw_record_map(ax_map, rec_bytes)

    # -- bottom: measured size ---------------------------------------------
    # Single-line labels: the two-line versions were clipped by the left
    # margin, and the byte counts are already stated beside each bar.
    labels = ["CSV", ".vtx"]
    vals = [csv_total / 1e6, vtx_total / 1e6]
    bars = ax_bar.barh(labels, vals, height=0.52,
                       color=[C.BORDER, C.PRIMARY], zorder=3)
    ax_bar.invert_yaxis()
    ax_bar.set_xlabel("Megabytes for this recording")
    # Headroom for the longest in-bar label, which sits outside the bar end.
    ax_bar.set_xlim(0, csv_total / 1e6 * 1.30)
    ax_bar.grid(axis="x", alpha=0.25)
    ax_bar.grid(axis="y", visible=False)

    # Byte count on the baseline, note stacked under it. Side by side, the
    # longer CSV note runs past the right edge of the axes.
    notes = [f"{csv_row:.0f} B/sample — text, must be scanned",
             f"{rec_bytes} B/sample — fixed width, seek by index"]
    for b, v, note in zip(bars, vals, notes):
        cy = b.get_y() + b.get_height() / 2
        # MB figure hugs its bar; the note sits inside the bar, right-aligned
        # at the end. Hanging both off the bar end puts the longer CSV note
        # past the axes edge no matter how much headroom the xlim carries.
        ax_bar.text(v + csv_total / 1e6 * 0.02, cy, f"{v:.0f} MB",
                    ha="left", va="center", fontsize=13, weight="600",
                    color=C.INK)
        ax_bar.text(v - csv_total / 1e6 * 0.015, cy, note,
                    ha="right", va="center", fontsize=10.5,
                    color=C.TEXT_2 if v > vals[1] else "white", zorder=5)

    # In the gap between the two bars, aligned to where the .vtx bar ends —
    # it reads as a caption on the difference rather than on either bar.
    ax_bar.text(vtx_total / 1e6 + csv_total / 1e6 * 0.02,
                (bars[0].get_y() + bars[0].get_height()
                 + bars[1].get_y()) / 2,
                f"{reduction:.0%} smaller", ha="left", va="center",
                fontsize=14, weight="600", color=C.CONTRAST, zorder=5)

    fig.text(0.075, 0.975,
             f"{rec_bytes} bytes per sample, seekable, no ASCII",
             ha="left", va="top", fontsize=15.5, weight="600", color=C.INK)

    fig.text(0.5, 0.012,
             f"{Path(SRC).name} · {n:,} records over {hours:.1f} h · "
             f"record_format 0x{int(h.record_format):02X} (accel + gyro) · "
             f"CSV row measured at {csv_row:.0f} B from real values",
             ha="center", va="bottom", fontsize=8.5, color=C.TEXT_3,
             family="monospace")

    fig.subplots_adjust(top=0.90, bottom=0.155, left=0.075, right=0.975)
    save(fig, OUT)

    print(f"\n  record        {rec_bytes} bytes, format "
          f"0x{int(h.record_format):02X}")
    print(f"  records       {n:,} over {hours:.1f} h")
    print(f"  .vtx          {vtx_total / 1e6:.1f} MB")
    print(f"  CSV row       {csv_row:.1f} B mean (measured)")
    print(f"  CSV total     {csv_total / 1e6:.1f} MB")
    print(f"  reduction     {reduction:.1%}")
    print("\n  NOTE: the spec's 78% assumes a 130 B CSV row against a 56 B "
          "9-DoF record.\n        For the 28 B 6-DoF record that ships "
          f"today the honest figure is {reduction:.0%}.\n")


if __name__ == "__main__":
    main()

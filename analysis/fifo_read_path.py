"""
FIFO read path — slide 5b.

Two panels:

  Top     why the read costs six I2C transactions per sample. The LSM6DS3
          FIFO is a two-byte window at 0x3E-0x3F; I2C auto-increment walks
          past it into unrelated registers instead of popping the next word,
          so each word needs its own transaction.

  Bottom  what the FIFO buys, measured on a real 4 h ride: 95% of reads find
          a single sample waiting, and the FIFO only fills when the loop
          stalls. Worst observed stall used 21% of its depth.

WHY THE MEASURED PANEL MATTERS
------------------------------
The slide's earlier draft described a 100 ms read cadence pulling ~10 samples
a time. That is not what the firmware does — `readFIFO()` is called every loop
iteration and usually finds one sample. The FIFO is not a batching optimisation
in steady state; it is *insurance against a stall*, and the distribution below
is what shows that. Presenting the design intent instead of the measurement
would have been a claim nobody could check.

Run:
    cd analysis && ../venv-analysis/bin/python fifo_read_path.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent / "packages/vtx-parser/python"))
sys.path.insert(0, str(_HERE))

from plot_style import C, save, setup  # noqa: E402
from vtx_parser import decode_vtx  # noqa: E402

import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import FancyArrowPatch, Rectangle  # noqa: E402

SRC = "data/sample-recordings/9_13_2026_34988967.vtx"

ODR_HZ = 104
FIFO_WORDS = 682            # LSM6DS3 FIFO depth
WORDS_PER_SAMPLE = 6        # gyro XYZ + accel XYZ, one 16-bit word each

OUT = "05b_fifo_read_path"


def _arrow(ax, x0, y0, x1, y1, color, lw=2.0, ms=13, ls="-"):
    ax.add_patch(FancyArrowPatch(
        (x0, y0), (x1, y1), arrowstyle="-|>", mutation_scale=ms,
        color=color, lw=lw, linestyle=ls, shrinkA=0, shrinkB=0, zorder=5,
    ))


def draw_register_window(ax) -> None:
    """Top panel: the two-byte window, and where auto-increment goes wrong."""
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 3.4)
    ax.axis("off")

    # Register strip. 0x3E-0x3F is the FIFO window; everything past it is
    # unrelated, which is the whole point.
    names = ["0x3C", "0x3D", "0x3E", "0x3F", "0x40", "0x41", "0x42"]
    fifo = {"0x3E", "0x3F"}
    x0, w, y, h = 1.15, 1.06, 1.55, 0.80
    for i, nm in enumerate(names):
        x = x0 + i * w
        inside = nm in fifo
        ax.add_patch(Rectangle(
            (x, y), w * 0.94, h,
            facecolor="white" if inside else C.BORDER,
            edgecolor=C.CONTRAST if inside else C.TEXT_3,
            lw=2.4 if inside else 1.2, alpha=1.0 if inside else 0.55,
            zorder=3,
        ))
        ax.text(x + w * 0.47, y + h / 2, nm, ha="center", va="center",
                fontsize=11.5, family="monospace", zorder=4,
                color=C.INK if inside else C.TEXT_2)

    fifo_x0 = x0 + 2 * w
    fifo_cx = fifo_x0 + w
    ax.text(fifo_cx, y + h + 0.20, "FIFO data window", ha="center",
            va="bottom", fontsize=11.5, weight="600", color=C.CONTRAST)
    ax.text(x0 + 5.1 * w, y - 0.22, "unrelated registers", ha="center",
            va="top", fontsize=11, color=C.TEXT_2, style="italic")

    # What auto-increment does: keeps walking right, off the window.
    _arrow(ax, fifo_cx + 0.30, y + h + 0.92, x0 + 6.5 * w, y + h + 0.92,
           C.TEXT_2, lw=1.8, ls=(0, (5, 4)))
    # No arrow glyph — the deck face has no U+2192.
    ax.text(fifo_cx + 0.24, y + h + 1.06,
            "I²C auto-increment keeps walking: garbage after the first word",
            ha="left", va="bottom", fontsize=11, color=C.TEXT_2)

    # What the firmware does instead.
    ax.annotate(
        "one transaction per word, address re-sent each time",
        xy=(fifo_cx, y), xytext=(fifo_cx, y - 0.78),
        ha="center", va="top", fontsize=11.5, color=C.CONTRAST,
        arrowprops=dict(arrowstyle="-|>", color=C.CONTRAST, lw=2.0,
                        shrinkA=2, shrinkB=2),
    )


def main() -> None:
    setup()

    recs = decode_vtx(Path(SRC).read_bytes()).records
    ts = np.array([r.timestamp for r in recs], dtype=np.float64)
    uniq, counts = np.unique(ts, return_counts=True)
    gaps = np.diff(uniq)
    gaps = gaps[gaps > 0]

    fifo_samples = FIFO_WORDS / WORDS_PER_SAMPLE
    fifo_ms = fifo_samples / ODR_HZ * 1000.0
    worst = float(gaps.max())

    fig, (ax_top, ax_bot) = plt.subplots(
        2, 1, figsize=(11.0, 6.2),
        gridspec_kw={"height_ratios": [0.60, 1.0], "hspace": 0.10},
        layout="none",
    )

    draw_register_window(ax_top)

    # -- bottom: measured batch sizes ---------------------------------------
    # Log y: 95% of reads return one sample, and the tail is the interesting
    # part. Linear would render everything past batch=2 as invisible.
    edges = np.arange(0.5, min(counts.max(), 24) + 1.5, 1.0)
    ax_bot.hist(counts, bins=edges, color=C.PRIMARY, zorder=3)
    ax_bot.set_yscale("log")
    ax_bot.set_xlabel("Samples returned per FIFO read")
    ax_bot.set_ylabel("Number of reads")
    ax_bot.set_xlim(0.4, min(counts.max(), 24) + 0.6)
    ax_bot.grid(axis="y", alpha=0.25)
    ax_bot.grid(axis="x", visible=False)

    pct1 = 100.0 * (counts == 1).sum() / len(counts)
    ax_bot.annotate(
        f"{pct1:.0f}% of reads find a single sample\n"
        "— the loop keeps up in steady state",
        xy=(1, (counts == 1).sum()), xytext=(28, -12),
        textcoords="offset points", ha="left", va="top",
        fontsize=10.5, color=C.TEXT_2, linespacing=1.4,
        arrowprops=dict(arrowstyle="-", color=C.TEXT_3, lw=0.9,
                        shrinkA=2, shrinkB=4),
    )
    # Anchored in axes fraction, not data: on a log axis with a count of 1 the
    # data anchor sits on the bottom spine and the label lands off-figure.
    ax_bot.annotate(
        f"the tail is stalls — worst was {counts.max()} samples\n"
        f"({worst:.0f} ms, {worst / fifo_ms:.0%} of FIFO depth)",
        xy=(0.965, 0.10), xycoords="axes fraction",
        xytext=(-12, 58), textcoords="offset points",
        ha="right", va="bottom", fontsize=10.5, color=C.CONTRAST,
        linespacing=1.4,
        arrowprops=dict(arrowstyle="-", color=C.CONTRAST, lw=0.9,
                        shrinkA=2, shrinkB=4),
    )

    # Integer ticks — a read returns a whole number of samples.
    ax_bot.set_xticks(range(1, min(int(counts.max()), 24) + 1, 2))

    fig.text(0.075, 0.975,
             "Six I²C transactions per sample — and why that is affordable",
             ha="left", va="top", fontsize=15.5, weight="600", color=C.INK)

    fig.text(0.5, 0.012,
             f"{Path(SRC).name} · {len(recs):,} samples over "
             f"{(ts[-1] - ts[0]) / 3.6e6:.1f} h at {ODR_HZ} Hz · "
             f"FIFO depth {FIFO_WORDS} words = {fifo_samples:.0f} samples "
             f"= {fifo_ms:.0f} ms",
             ha="center", va="bottom", fontsize=8.5, color=C.TEXT_3,
             family="monospace")

    fig.subplots_adjust(top=0.90, bottom=0.145, left=0.075, right=0.975)
    save(fig, OUT)

    print(f"\n  reads            {len(counts):,}")
    print(f"  batch == 1       {pct1:.1f}% of reads")
    print(f"  batch max        {counts.max()} samples")
    print(f"  read gap         median {np.median(gaps):.0f} ms · "
          f"p99 {np.percentile(gaps, 99):.0f} ms · max {worst:.0f} ms")
    print(f"  FIFO depth       {fifo_samples:.0f} samples = {fifo_ms:.0f} ms")
    print(f"  worst stall used {worst / fifo_ms:.1%} of depth")
    print(f"  I²C rate         {WORDS_PER_SAMPLE * ODR_HZ} transactions/s\n")


if __name__ == "__main__":
    main()

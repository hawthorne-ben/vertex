"""
Crash tolerance under real power loss — slide 6b.

Top     the patch cadence as a timeline: patchHeader() fires every 1040
        records, the battery was pulled between patches, and the header the
        file was left with is the one written at the last boundary.
Bottom  what that header claimed against what the file actually contained.

WHY NOT A PHOTO
---------------
A photo of a disconnected battery shows a disconnected battery. It cannot show
that the file survived, which is the whole claim, and staging one after the
fact is a representation of a test rather than its result. This chart is the
measured trial: battery JST pulled mid-recording on 2026-09-06, device
rebooted, file uploaded and parsed.

THE NUMBERS ARE FROM notes/VALIDATION_PLAN.md C1, trial 1
---------------------------------------------------------
Everything below is measured, not modelled. The one number that is drawn
rather than measured is the position of the cut inside the final interval:
the trial landed exactly on a patch boundary, so the records lost after the
last patch were zero.

HONESTY NOTE, AND IT BELONGS ON THE SLIDE
-----------------------------------------
The plan called for three cuts at varying offsets. One was run. Both unclean
terminations so far landed on exact patch boundaries, which is the favourable
case. The figure says "did not fail in one trial", never "cannot fail" —
patchHeader() does two seeks and two 8-byte writes, and that window is small
but real.

Run:
    cd analysis && ../venv-analysis/bin/python power_cut.py
"""

from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent / "packages/vtx-parser/python"))
sys.path.insert(0, str(_HERE))

from plot_style import C, save, setup  # noqa: E402

import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import Rectangle  # noqa: E402

# Measured: VALIDATION_PLAN.md C1 trial 1, 2026-09-06.
SRC = "9_6_2026_38967247.vtx"
PATCH_EVERY = 1040          # records between periodic patchHeader() calls
HEADER_COUNT = 15_600       # what the header claimed
ACTUAL_COUNT = 15_600       # what the file contained
DURATION_S = 151.6
END_TS_DELTA_MS = 1         # end_timestamp vs last record timestamp
RATE_HZ = 102.98

OUT = "06b_power_cut"


def draw_timeline(ax) -> None:
    """Top panel: patch cadence, with the cut drawn where it landed."""
    n_patches = HEADER_COUNT // PATCH_EVERY      # 15 patches
    # Right margin carries the "battery pulled" label, which is anchored at
    # the cut and runs leftward. Anchored rightward it clips at the axes edge.
    ax.set_xlim(-0.6, n_patches + 0.6)
    ax.set_ylim(0, 3.0)
    ax.axis("off")

    y, h = 1.30, 0.52

    # The recording, as a bar of records.
    ax.add_patch(Rectangle((0, y), n_patches, h, facecolor=C.PRIMARY,
                           edgecolor="none", zorder=2))

    # Patch marks. Each one rewrites record_count and end_timestamp in the
    # 64-byte header, so the file on disk is always self-describing.
    for i in range(n_patches + 1):
        ax.plot([i, i], [y - 0.10, y + h + 0.10], color="white", lw=1.6,
                zorder=3, solid_capstyle="butt")

    # Left-anchored: the "battery pulled" callout occupies the upper right.
    ax.text(0, y + h + 0.30,
            f"patchHeader() every {PATCH_EVERY:,} records "
            f"({PATCH_EVERY / RATE_HZ:.1f} s)",
            ha="left", va="bottom", fontsize=11.5, color=C.TEXT_2)

    # The cut. It landed on a boundary, which is the favourable case and the
    # figure says so rather than hiding it.
    ax.annotate(
        "battery pulled",
        xy=(n_patches, y + h + 0.14), xytext=(n_patches - 0.45, y + h + 0.92),
        ha="right", va="bottom", fontsize=12.5, weight="600", color=C.CONTRAST,
        arrowprops=dict(arrowstyle="-|>", color=C.CONTRAST, lw=1.8,
                        shrinkA=2, shrinkB=2,
                        connectionstyle="arc3,rad=-0.28"),
        zorder=6,
    )
    ax.plot([n_patches, n_patches], [y - 0.22, y + h + 0.22],
            color=C.CONTRAST, lw=2.6, zorder=5, solid_capstyle="butt")

    ax.text(0, y - 0.30, "start", ha="left", va="top",
            fontsize=10, color=C.TEXT_3, family="monospace")
    ax.text(n_patches, y - 0.30,
            f"{HEADER_COUNT:,} records, {DURATION_S:.0f} s",
            ha="right", va="top", fontsize=10, color=C.TEXT_3,
            family="monospace")

    ax.text(n_patches / 2, y - 0.86,
            "No closeFile(). The header the file was left with is the one the "
            "last periodic patch wrote.",
            ha="center", va="top", fontsize=11.5, color=C.INK)


def draw_result(ax) -> None:
    """Bottom panel: what the header claimed vs what was there."""
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")

    cells = [
        ("header record_count", f"{HEADER_COUNT:,}", C.INK),
        ("actual records", f"{ACTUAL_COUNT:,}", C.INK),
        ("delta", "0", C.CONTRAST),
        ("count % 1040", "0", C.CONTRAST),
        ("end_timestamp error", f"{END_TS_DELTA_MS} ms", C.CONTRAST),
    ]
    n = len(cells)
    for i, (label, value, color) in enumerate(cells):
        x = (i + 0.5) / n
        ax.text(x, 0.72, value, ha="center", va="center", fontsize=21,
                weight="600", color=color, family="monospace")
        ax.text(x, 0.30, label, ha="center", va="center", fontsize=10.5,
                color=C.TEXT_2)
        if i:
            ax.plot([i / n, i / n], [0.14, 0.90], color=C.BORDER, lw=1.0)


def main() -> None:
    setup()

    fig, (ax_tl, ax_res) = plt.subplots(
        2, 1, figsize=(11.0, 5.8),
        gridspec_kw={"height_ratios": [1.0, 0.42], "hspace": 0.16},
        layout="none",
    )

    draw_timeline(ax_tl)
    draw_result(ax_res)

    fig.text(0.075, 0.975,
             "A power cut still leaves a valid file",
             ha="left", va="top", fontsize=15.5, weight="600", color=C.INK)

    fig.text(0.5, 0.012,
             f"{SRC} - battery JST pulled mid-recording, 2026-09-06 - "
             f"{RATE_HZ:.2f} Hz implied rate\n"
             "One trial, and it landed on a patch boundary. The torn-write "
             "window in patchHeader() is unobserved, not disproven.",
             ha="center", va="bottom", fontsize=8.5, color=C.TEXT_3,
             family="monospace", linespacing=1.5)

    fig.subplots_adjust(top=0.90, bottom=0.165, left=0.075, right=0.975)
    save(fig, OUT)

    print(f"\n  source      {SRC}")
    print(f"  header      {HEADER_COUNT:,} records")
    print(f"  actual      {ACTUAL_COUNT:,} records")
    print(f"  delta       {HEADER_COUNT - ACTUAL_COUNT}")
    print(f"  boundary    {HEADER_COUNT % PATCH_EVERY} "
          f"(exact multiple of {PATCH_EVERY:,})")
    print(f"  end_ts err  {END_TS_DELTA_MS} ms\n")


if __name__ == "__main__":
    main()

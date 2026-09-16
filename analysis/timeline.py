"""
Project timeline — slide 1b, reused struck-through on slide 10.

Three lanes over the same date axis:

  1. Phase bands      V1, the gap, V2 — the shape of the project.
  2. Commits/month    from git. Shows where the effort actually went.
  3. IMU hours/month  from production. Shows what the effort produced.

The argument the chart makes without a word spoken: the commit spike is at the
start, on V1, and it produced almost no data. V2 has a fraction of the commits
and nearly all of the hours. Effort and outcome are in different places, and
the gap between them is where the project changed direction.

Two knobs worth knowing:

    STRIKE_V1 = False   ->  slide 1b, the project as it happened
    STRIKE_V1 = True    ->  slide 10, V1 crossed out: "skip V1 entirely"

Run:
    cd analysis && ../venv-analysis/bin/python timeline.py
"""

from __future__ import annotations

import subprocess
import sys
from datetime import date
from pathlib import Path

import matplotlib.dates as mdates
import matplotlib.pyplot as plt

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))

from plot_style import C, save, setup  # noqa: E402

REPO = _HERE.parent

# Set True to render the slide 10 variant.
STRIKE_V1 = False

OUT = "10_timeline_doover" if STRIKE_V1 else "01b_timeline"


# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------

# IMU hours per month, split by hardware generation. Snapshot rather than a
# live query so the chart builds without credentials; regenerate with
# web/scripts/presentation-stats.ts. Measured 2026-09-15. Excludes the paired
# .fit rows, which have no sample rate and would double-count the same rides.
#
# Split on SAMPLE RATE (>=104 Hz is V2), not on calendar date. February 2026 is
# why: it is the single biggest month in the corpus at 34.0 h and it is
# entirely V1, recorded in the weeks before the approach was abandoned. Dating
# the split at the first V2 commit would have mislabelled all of it.
#
# Totals reconcile with the corpus stats: V1 40.1 h, V2 102.2 h.
IMU_HOURS = {
    #            V1     V2
    "2025-10": (0.2,   0.0),
    "2025-11": (2.3,   0.0),
    "2025-12": (0.8,   0.0),
    "2026-01": (2.9,   1.3),
    "2026-02": (34.0,  0.0),
    "2026-03": (0.0,  33.7),
    "2026-04": (0.0,   6.5),
    "2026-05": (0.0,  15.4),
    "2026-06": (0.0,  13.8),
    "2026-07": (0.0,   9.4),
    "2026-08": (0.0,  11.6),
    "2026-09": (0.0,  10.5),
}

# Phase boundaries. Dates are from git, not recollection:
#   2025-10-21  first commit
#   2026-01-06  "firmware bug, fusion experiments, debug charting" — last V1
#               firmware commit, and the moment the approach was abandoned
#   2026-02-28  "v2 build + firmware"
V1_START = date(2025, 10, 21)
V1_END = date(2026, 1, 6)
V2_START = date(2026, 2, 28)
TODAY = date(2026, 9, 15)

PHASES = [
    (V1_START, V1_END, "V1 — ESP32 + BNO055, onboard fusion", C.CONTRAST),
    (V1_END, V2_START, "", C.TEXT_3),
    (V2_START, TODAY, "V2 — LSM6DS3, raw 6-DoF, SD capture", C.PRIMARY),
]

# Called out on the chart. Kept to four: more turns a shape into a list.
# Event markers were removed deliberately. The three lanes already show the
# shape — two phases, a gap, and where the data actually came from — and
# everything a marker said ("fusion experiments", the 53-day gap, the drift
# measurement) is better delivered out loud than printed on the slide. Anything
# on the chart is something to defend under questioning; anything spoken is a
# choice made in the room.


def commits_by_month() -> dict[str, int]:
    """Commit counts per YYYY-MM from git. Empty dict if git is unavailable."""
    try:
        out = subprocess.run(
            ["git", "log", "--date=format:%Y-%m", "--pretty=%ad"],
            cwd=REPO, capture_output=True, text=True, timeout=30,
        )
        if out.returncode != 0:
            return {}
    except (OSError, subprocess.SubprocessError):
        return {}
    counts: dict[str, int] = {}
    for line in out.stdout.split("\n"):
        k = line.strip()
        if k:
            counts[k] = counts.get(k, 0) + 1
    return counts


def month_starts(keys) -> list[date]:
    return [date(int(k[:4]), int(k[5:7]), 1) for k in keys]


# ---------------------------------------------------------------------------
# Plot
# ---------------------------------------------------------------------------


def main() -> None:
    setup()
    commits = commits_by_month()
    if not commits:
        print("  ! git log unavailable — commit lane will be empty")

    months = sorted(set(commits) | set(IMU_HOURS))
    xs = month_starts(months)
    cvals = [commits.get(m, 0) for m in months]
    h1 = [IMU_HOURS.get(m, (0.0, 0.0))[0] for m in months]
    h2 = [IMU_HOURS.get(m, (0.0, 0.0))[1] for m in months]
    hvals = [a + b for a, b in zip(h1, h2)]

    fig, (ax_p, ax_c, ax_h) = plt.subplots(
        3, 1, figsize=(11.0, 6.4), sharex=True,
        gridspec_kw={"height_ratios": [0.42, 1.0, 1.0], "hspace": 0.40},
        layout=None,
    )

    # -- lane 1: phase bands ------------------------------------------------
    for start, end, label, color in PHASES:
        ax_p.axvspan(start, end, color=color,
                     alpha=0.16 if label else 0.07, lw=0)
        if label:
            mid = start + (end - start) / 2
            ax_p.text(mid, 0.5, label, ha="center", va="center",
                      fontsize=11.5, weight="600", color=color)

    # The gap needs no label — it is a visible hole between two filled bands,
    # and how long it was is a thing to say, not to print.
    gap_days = (V2_START - V1_END).days

    if STRIKE_V1:
        ax_p.plot([V1_START, V1_END], [0.5, 0.5],
                  color=C.CONTRAST, lw=2.4, zorder=5)
        ax_p.text(V1_START + (V1_END - V1_START) / 2, 0.03,
                  "delete this", ha="center", va="bottom",
                  fontsize=10, style="italic", color=C.CONTRAST)

    ax_p.set_ylim(0, 1)
    ax_p.set_yticks([])
    for side in ("left", "right", "top", "bottom"):
        ax_p.spines[side].set_visible(False)

    # -- lane 2: commits ----------------------------------------------------
    bar_colors = [
        C.CONTRAST if date(int(m[:4]), int(m[5:7]), 1) < V2_START else C.PRIMARY
        for m in months
    ]
    ax_c.bar(xs, cvals, width=22, color=bar_colors, zorder=3)
    ax_c.set_ylabel("Commits", fontsize=11)
    ax_c.set_ylim(0, max(cvals + [1]) * 1.30)

    # No annotation on the commit lane. The month-one spike is what every
    # project looks like at the start, and the colour split already says which
    # generation the effort went to — a label saying so is noise.

    # -- lane 3: IMU hours, split by generation -----------------------------
    # Stacked, but the two never share a month except January, so it reads as
    # one series changing colour when the hardware changed.
    ax_h.bar(xs, h1, width=22, color=C.CONTRAST, zorder=3, label="V1")
    ax_h.bar(xs, h2, width=22, bottom=h1, color=C.PRIMARY, zorder=3, label="V2")
    ax_h.set_ylabel("IMU hours recorded", fontsize=11)
    ax_h.set_ylim(0, max(hvals + [1.0]) * 1.34)

    v1_h, v2_h = sum(h1), sum(h2)
    # Totals, placed in empty space rather than against the bars they describe:
    # V1's label sits over the near-empty Oct–Dec run, V2's over Jun–Sep.
    ax_h.annotate(
        f"{v1_h:.0f} h total on V1",
        xy=(date(2025, 11, 10), 0), xytext=(0, 34),
        textcoords="offset points", ha="center",
        fontsize=10.5, weight="600", color=C.CONTRAST,
    )
    # Anchored above the tallest bar it sits over rather than at the axis, so
    # it clears the Jun–Sep run instead of landing on top of it.
    tail = [h for m, h in zip(months, h2) if m >= "2026-06"]
    ax_h.annotate(
        f"{v2_h:.0f} h total on V2",
        xy=(date(2026, 7, 20), max(tail or [0.0])), xytext=(0, 24),
        textcoords="offset points", ha="center",
        fontsize=10.5, weight="600", color=C.PRIMARY,
    )

    # -- axis ---------------------------------------------------------------
    ax_h.xaxis.set_major_locator(mdates.MonthLocator(interval=1))
    ax_h.xaxis.set_major_formatter(mdates.DateFormatter("%b"))
    ax_h.set_xlim(date(2025, 10, 1), date(2026, 10, 1))

    # Year labels, once each, under the month ticks.
    for yr, mo in ((2025, 11), (2026, 5)):
        ax_h.annotate(str(yr), xy=(date(yr, mo, 15), 0),
                      xycoords=("data", "axes fraction"),
                      xytext=(0, -30), textcoords="offset points",
                      ha="center", fontsize=10.5, color=C.TEXT_2)

    for ax in (ax_c, ax_h):
        ax.grid(axis="y", alpha=0.25, zorder=0)
        ax.grid(axis="x", visible=False)

    total_days = (TODAY - V1_START).days
    title = ("Half the time: skip V1 entirely" if STRIKE_V1
             else f"{total_days} days, two hardware generations, one engineer")
    # Title on the figure rather than the axes, so it aligns with the left edge
    # of the y-axis labels instead of the plot area.
    fig.text(0.085, 0.975, title, ha="left", va="top",
             fontsize=15.5, weight="600", color=C.INK)

    fig.text(
        0.5, 0.012,
        "Commits from git · IMU hours from production, paired .fit files "
        "excluded · measured 2026-09-15",
        ha="center", va="bottom", fontsize=8.5, color=C.TEXT_3,
        family="monospace",
    )

    # vertex.mplstyle enables a constrained layout engine, which fights the
    # manual margins this chart needs for the stagger above lane 1.
    fig.set_layout_engine("none")
    fig.subplots_adjust(top=0.90, bottom=0.13, left=0.085, right=0.975)
    save(fig, OUT)

    print(f"\n  V1: {V1_START} → {V1_END}  "
          f"({(V1_END - V1_START).days} days, {v1_h:.1f} h recorded)")
    print(f"  gap: {gap_days} days")
    print(f"  V2: {V2_START} → {TODAY}  "
          f"({(TODAY - V2_START).days} days, {v2_h:.1f} h recorded)")
    print(f"  total: {total_days} days, {sum(cvals)} commits\n")


if __name__ == "__main__":
    main()

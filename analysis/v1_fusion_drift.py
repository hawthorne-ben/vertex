"""
V1 fusion drift — slide 3d.

The BNO055's own orientation output over six minutes of riding. Roll and pitch
both ramp steadily upward while the bike is, on average, doing neither.

PROVENANCE
----------
This reproduces a chart from an earlier Substack post whose source file was not
recorded. It was identified by searching the V1 corpus for the signature — a
~5.5 minute window with roll rising ~14 deg and pitch ~20 deg from near zero —
and confirmed against the wall clock: the file starts 12:53:22 PST and the
original chart's axis runs 12:56:30 to 13:02:10, which is t = 188..528 s.

WHY THIS AND NOT A GRAVITY COMPARISON
-------------------------------------
An earlier version of this slide plotted fused pitch against a low-passed
accelerometer reference. That was defensible but indirect — it required
explaining what the reference was and why it was trustworthy before the
audience could read the disagreement.

This is better because it needs no reference at all. Both channels climb
monotonically for six minutes. A bike does not pitch nose-up by twenty degrees
and stay there, and it does not simultaneously roll fifteen degrees to one side
and hold. The output is drifting, and the plot shows it without any comparison
to argue about.

The two sharp excursions are real manoeuvres — corners, where roll genuinely
swings. They are left in deliberately: the drift is the slow ramp underneath
them, and smoothing them away would look like hiding something.

Run:
    cd analysis && ../venv-analysis/bin/python v1_fusion_drift.py
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

SRC = "data/sample-recordings/Bridge and hawk.vtx"

# Seconds into the file. Matches the original chart's 12:56:30 - 13:02:10
# against a 12:53:22 PST start.
WIN_START, WIN_END = 188.0, 528.0

# Trend line fitted across the window, drawn to make the ramp explicit.
SHOW_TREND = True

OUT = "03d_v1_fusion_drift"


def main() -> None:
    setup()

    recs = decode_vtx(Path(SRC).read_bytes()).records
    ts = np.array([r.timestamp for r in recs], dtype=np.float64)
    t = (ts - ts[0]) / 1000.0

    roll = np.array([r.roll for r in recs], dtype=np.float64)
    pitch = np.array([r.pitch for r in recs], dtype=np.float64)

    m = (t >= WIN_START) & (t <= WIN_END)
    tm = (t[m] - t[m][0]) / 60.0          # minutes from window start
    rm, pm = roll[m], pitch[m]
    fs = 1.0 / float(np.median(np.diff(t)))

    fig, ax = plt.subplots(figsize=(11.0, 5.6), layout="none")

    ax.plot(tm, pm, color=C.CONTRAST, lw=1.3, label="Pitch", zorder=4)
    ax.plot(tm, rm, color=C.PRIMARY, lw=1.3, label="Roll", zorder=4)
    ax.axhline(0, color=C.BORDER, lw=1.2, zorder=1)

    if SHOW_TREND:
        for series, color in ((pm, C.CONTRAST), (rm, C.PRIMARY)):
            k = np.polyfit(tm, series, 1)
            ax.plot(tm, np.polyval(k, tm), color=color, lw=2.6, ls=(0, (6, 4)),
                    alpha=0.85, zorder=5)

    ax.set_xlabel("Minutes")
    ax.set_ylabel("Reported angle (degrees)")
    ax.set_xlim(tm[0], tm[-1])
    ax.legend(loc="upper left", framealpha=0.9)
    ax.grid(axis="y", alpha=0.25)
    ax.grid(axis="x", visible=False)

    # Slope per minute is the number that makes this drift rather than terrain.
    kp = np.polyfit(tm, pm, 1)[0]
    kr = np.polyfit(tm, rm, 1)[0]

    # Both labels sit in the empty band below the traces. Anchoring them to
    # their own trend lines put them on top of the data — the traces climb
    # into exactly the space above and to the right where the labels went.
    lo = min(rm.min(), pm.min())
    ax.set_ylim(lo - 9.0, max(rm.max(), pm.max()) + 4.0)
    mid_x = tm[0] + (tm[-1] - tm[0]) * 0.40
    ax.text(mid_x, lo - 3.0, f"pitch climbing {kp:+.1f}°/min",
            ha="center", va="center", fontsize=12, weight="600",
            color=C.CONTRAST, zorder=6)
    ax.text(mid_x, lo - 6.4, f"roll climbing {kr:+.1f}°/min",
            ha="center", va="center", fontsize=12, weight="600",
            color=C.PRIMARY, zorder=6)

    fig.text(0.075, 0.975,
             "Six minutes of riding. The horizon walks away.",
             ha="left", va="top", fontsize=15.5, weight="600", color=C.INK)

    fig.text(0.5, 0.012,
             f"{Path(SRC).name} · V1 (BNO055 onboard fusion) · "
             f"{int(m.sum()):,} samples @ {fs:.0f} Hz · "
             f"t = {WIN_START:.0f}–{WIN_END:.0f} s (12:56:30–13:02:10 PST)",
             ha="center", va="bottom", fontsize=8.5, color=C.TEXT_3,
             family="monospace")

    fig.subplots_adjust(top=0.90, bottom=0.145, left=0.075, right=0.975)
    save(fig, OUT)

    print(f"\n  source     {Path(SRC).name}")
    print(f"  window     {WIN_START:.0f}–{WIN_END:.0f} s "
          f"({(WIN_END - WIN_START) / 60:.1f} min), "
          f"{int(m.sum()):,} samples @ {fs:.0f} Hz")
    print(f"  roll       {rm[0]:+.1f} -> {rm[-1]:+.1f}°   "
          f"trend {kr:+.2f}°/min")
    print(f"  pitch      {pm[0]:+.1f} -> {pm[-1]:+.1f}°   "
          f"trend {kp:+.2f}°/min")
    print(f"  extrapolated over an hour: roll {kr * 60:+.0f}°, "
          f"pitch {kp * 60:+.0f}°\n")


if __name__ == "__main__":
    main()

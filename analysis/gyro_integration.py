"""
Why NAIVE integration fails — and what a fusion filter has to overcome.

IMPORTANT SCOPE NOTE. This shows raw cumulative integration, which is NOT what
a sensor fusion algorithm does. A complementary or Kalman filter continuously
corrects the integrated angle against the accelerometer's gravity vector, and
the drift plotted here is precisely what such a filter exists to remove.

So this chart does not prove orientation is impossible. It shows the size of
the error a filter must correct, and — via the two bias estimates — that the
correction cannot be a one-time calibration, because the bias moves while you
ride. Present it as motivation for why fusion is needed, never as evidence
that fusion cannot work.

Angle is the integral of rate, so any bias in the rate integrates into the
angle linearly with time. A 0.1 deg/s bias — invisible on a rate plot — is 8
degrees of error after 80 seconds. And the bias is not constant: it wanders
with temperature, 1/f noise, and vibration rectification, so you cannot
calibrate it away either.

The fix is an absolute reference to correct against. On a cornering bike the
usual one is degraded: the accelerometer measures gravity PLUS the cornering
acceleration being measured, so the reference is worst exactly when the signal
is most interesting. Magnetic heading was unreliable on this build and the
cause was never independently diagnosed.

This plots integrated angle for one descent, three ways:
  1. Raw integration — no correction at all.
  2. Bias-corrected using a stationary estimate from before the descent.
  3. Bias-corrected using an estimate from AFTER the descent.

(2) and (3) bracket the honest range: if bias were constant they would agree.
Where they diverge is the drift no calibration can remove.

    ../venv-analysis/bin/python gyro_integration.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from scipy.signal import butter, filtfilt

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent / "packages/vtx-parser/python"))
sys.path.insert(0, str(_HERE))

from plot_style import C, figure, save, setup  # noqa: E402
from vtx_parser import decode_vtx  # noqa: E402

SRC = "data/sample-recordings/9_7_2026_33823744.vtx"

# Run 3, the committed descent. 53 s — short, which makes the point sharper:
# this is not a multi-hour accumulation, it is under a minute.
TOP_S, BOTTOM_S = 3017, 3070
# Quiet windows either side, used to estimate the bias. Stopped at the top
# before starting, and rolled out at the bottom.
PRE_S, POST_S = (2990, 3010), (3080, 3100)
LPF_HZ = 5.0   # kill road vibration only; the point is what survives that


def main():
    v = decode_vtx((_HERE / SRC).read_bytes())
    recs = v.records
    ts = np.array([r.timestamp for r in recs], dtype=np.float64)
    t = (ts - ts[0]) / 1000.0
    fs = 1.0 / float(np.median(np.diff(t)[np.diff(t) > 0]))

    def axis(name):
        return np.array([getattr(r, name) for r in recs], dtype=np.float64)

    g = {k: axis(f"gyro_{k}") for k in "xyz"}

    def window(a, b):
        return slice(np.searchsorted(t, a), np.searchsorted(t, b))

    pre, post, run = window(*PRE_S), window(*POST_S), window(TOP_S, BOTTOM_S)

    print("=" * 74)
    print("Bias estimated from two stationary windows either side of one 53 s descent")
    print(f"{'axis':<8}{'pre (deg/s)':>14}{'post (deg/s)':>15}{'drift':>12}"
          f"{'-> angle err':>16}")
    print("-" * 74)
    dur = BOTTOM_S - TOP_S
    bias = {}
    for k in "xyz":
        b_pre = float(np.mean(g[k][pre]))
        b_post = float(np.mean(g[k][post]))
        bias[k] = (b_pre, b_post)
        print(f"gyro_{k:<3}{b_pre:>14.4f}{b_post:>15.4f}{b_post - b_pre:>12.4f}"
              f"{(b_post - b_pre) * dur:>13.1f} deg")
    print("=" * 74)
    print(f"Even a PERFECT bias estimate taken seconds earlier leaves the drift")
    print(f"shown in the last column after only {dur} s of riding.\n")

    setup()
    fig, axes = figure(nrows=3, height=8.4, sharex=True)
    names = {"x": "Roll", "y": "Pitch", "z": "Yaw"}

    tt = t[run] - t[run][0]
    for ax, k in zip(axes, "xyz"):
        raw = filtfilt(*butter(4, LPF_HZ / (fs / 2), btype="low"), g[k])[run]
        b_pre, b_post = bias[k]
        dt = 1.0 / fs
        ax.plot(tt, np.cumsum(raw) * dt, color=C.CONTRAST, lw=2.2,
                label="raw integration")
        ax.plot(tt, np.cumsum(raw - b_pre) * dt, color=C.PRIMARY, lw=2.2,
                label="bias from before")
        ax.plot(tt, np.cumsum(raw - b_post) * dt, color=C.SECONDARY, lw=2.2,
                ls="--", label="bias from after")
        ax.axhline(0, color=C.BORDER, lw=1.0, zorder=0)
        ax.set_ylabel(f"{names[k]} angle (deg)\nintegrated gyro_{k}")

    axes[0].legend(loc="upper left", fontsize=10, ncol=3)
    axes[0].set_title(
        "Raw gyro integration over one 53 s descent — no correction applied",
        loc="left")
    axes[-1].set_xlabel("Time into descent (s)")

    fig.text(0.5, -0.012,
             "Naive integration only — a fusion filter would correct this against "
             "gravity. The point is the size of the correction needed, and that two "
             "bias estimates 90 s apart disagree by enough to matter in 53 s.",
             ha="center", va="top", fontsize=9, color=C.TEXT_2)
    save(fig, "03_gyro_integration_drift")


if __name__ == "__main__":
    main()

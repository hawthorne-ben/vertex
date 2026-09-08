"""
Corner comparison — two runs through the same corner.

The argument this chart makes: **absolute orientation is unrecoverable on this
hardware, and it was not needed.** Nothing here is integrated. Nothing is a
lean angle. Two rate traces, compared directly, and the difference in how the
corner was taken is obvious without ever knowing which way "down" was.

MODES
-----
Alignment is set by ALIGN:

  "mark"  — x-axis is seconds from the timestamp you supply per run.
            Use shift_s to nudge. Simplest; what to use before you have gates.

  "gates" — you supply entry and exit timestamps per run (read off the map in
            the web UI). The corner is resampled to 0-100% traversal, so two
            runs at different speeds overlay on corner *progress* rather than
            elapsed time. Also reports time-through-corner per run.

CAVEAT on gates: hand-picked from a 1 Hz GPS slider, so each gate carries
roughly +/-1 s. A corner taking ~5 s means traversal-time differences under a
second are inside the error. Use gates for SHAPE comparison; do not claim a
speed difference from them.

    ../venv-analysis/bin/python corner_compare.py
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Optional

import numpy as np
from scipy.signal import butter, filtfilt

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent / "packages/vtx-parser/python"))
sys.path.insert(0, str(_HERE))

from plot_style import C, figure, save, setup  # noqa: E402
from vtx_parser import decode_vtx  # noqa: E402


# ============================== EDIT THIS ==================================

D = "data/sample-recordings/recordings-2026-09-06/"

ALIGN: Literal["mark", "gates"] = "mark"

LPF_HZ = 0.5          # zero-phase low-pass. Cornering is well under 1 Hz.
BASELINE_HZ = 0.05    # grade baseline; subtracted from longitudinal to isolate
                      # braking. Grade changes slowly, braking does not.
PAD_S = 20.0          # extra signal filtered either side, then trimmed
WINDOW_S = 6.0        # +/- seconds shown, "mark" mode only
OUT = "04_corner_compare"


@dataclass
class Run:
    path: str
    label: str
    color: str
    mark_s: float                    # seconds into file; corner reference
    shift_s: float = 0.0             # nudge after looking at the chart
    entry_s: Optional[float] = None  # gates mode: corner entry
    exit_s: Optional[float] = None   # gates mode: corner exit


RUNS = [
    Run(D + "5_14_2026_18510832.vtx",  "May 14", C.PRIMARY,  mark_s=55*60 + 24),
    Run(D + "03-13_155529-174815.vtx", "Mar 13", C.CONTRAST, mark_s=53*60 + 57),
]

# ===========================================================================


def _lowpass(x, fs, hz, order=4):
    nyq = fs / 2.0
    if hz >= nyq:
        return x
    b, a = butter(order, hz / nyq, btype="low")
    return filtfilt(b, a, x)


@dataclass
class Trace:
    label: str
    color: str
    x: np.ndarray          # seconds from mark, or 0-100 % traversal
    yaw: np.ndarray        # gyro_z — rotation about vertical
    roll: np.ndarray       # gyro_x — lean rate
    brake: np.ndarray      # accel_x minus slow baseline — braking, grade removed
    gload: np.ndarray      # |a| in g — cornering load, orientation-free
    fs: float
    dur_s: Optional[float]  # gates mode: time through the corner
    src: str


def load(run: Run) -> Trace:
    v = decode_vtx(Path(run.path).read_bytes())
    r = v.records
    ts = np.array([x.timestamp for x in r], dtype=np.float64)
    t = (ts - ts[0]) / 1000.0
    d = np.diff(t); d = d[d > 0]
    fs = 1.0 / float(np.median(d))

    # Body frame per firmware/imu_manager_v2/vtx_format.h:
    #   X forward (roll axis) · Y lateral (pitch axis) · Z vertical (yaw axis)
    yaw_raw  = np.array([x.gyro_z for x in r], dtype=np.float64)
    roll_raw = np.array([x.gyro_x for x in r], dtype=np.float64)
    lon_raw  = np.array([x.accel_x for x in r], dtype=np.float64)

    if ALIGN == "gates":
        if run.entry_s is None or run.exit_s is None:
            raise SystemExit(f"{run.label}: gates mode needs entry_s and exit_s")
        a, b = run.entry_s + run.shift_s, run.exit_s + run.shift_s
    else:
        c = run.mark_s + run.shift_s
        a, b = c - WINDOW_S, c + WINDOW_S

    plo = max(np.searchsorted(t, a - PAD_S), 0)
    phi = min(np.searchsorted(t, b + PAD_S), len(t))
    lo = max(np.searchsorted(t, a), 0)
    hi = min(np.searchsorted(t, b), len(t))
    keep = slice(lo - plo, hi - plo)

    lat_raw  = np.array([x.accel_y for x in r], dtype=np.float64)
    vert_raw = np.array([x.accel_z for x in r], dtype=np.float64)

    yaw  = _lowpass(yaw_raw[plo:phi],  fs, LPF_HZ)[keep]
    roll = _lowpass(roll_raw[plo:phi], fs, LPF_HZ)[keep]

    # Longitudinal accel is grade + braking superimposed: on a descent
    # gravity projects onto the forward axis as -g*sin(theta), which at ~10%
    # grade is ~1 m/s^2 of standing offset. Grade changes slowly, braking does
    # not — so subtracting a very slow baseline leaves the braking signal.
    lon_f  = _lowpass(lon_raw[plo:phi], fs, LPF_HZ)
    lon_bl = _lowpass(lon_raw[plo:phi], fs, BASELINE_HZ)
    brake  = (lon_f - lon_bl)[keep]

    # Total acceleration magnitude. Independent of orientation, so immune to
    # the drift that makes absolute attitude unrecoverable. In a clean corner
    # the resultant sits on the bike's own vertical axis, and |a| > 1 g is the
    # cornering load: cos(lean) = g / |a|.
    # Filter each axis only enough to kill road vibration (5 Hz), take the
    # magnitude, THEN smooth. Low-passing the axes hard before combining them
    # smooths away the peak that the magnitude is supposed to capture.
    m = np.sqrt(_lowpass(lon_raw[plo:phi],  fs, 5.0) ** 2
                + _lowpass(lat_raw[plo:phi],  fs, 5.0) ** 2
                + _lowpass(vert_raw[plo:phi], fs, 5.0) ** 2)
    gload = (_lowpass(m, fs, LPF_HZ) / 9.80665)[keep]
    tt = t[lo:hi]

    if ALIGN == "gates":
        dur = float(tt[-1] - tt[0])
        x = (tt - tt[0]) / dur * 100.0
    else:
        dur = None
        x = tt - (run.mark_s + run.shift_s)

    return Trace(run.label, run.color, x, yaw, roll, brake, gload, fs, dur, Path(run.path).name)


def main():
    traces = [load(r) for r in RUNS]

    print("=" * 70)
    for tr in traces:
        print(f"{tr.label}  ({tr.src}, {tr.fs:.0f} Hz)")
        print(f"   yaw  (gyro_z) {tr.yaw.min():+7.1f} .. {tr.yaw.max():+7.1f} deg/s"
              f"   p-p {tr.yaw.max()-tr.yaw.min():5.1f}")
        print(f"   roll (gyro_x) {tr.roll.min():+7.1f} .. {tr.roll.max():+7.1f} deg/s"
              f"   p-p {tr.roll.max()-tr.roll.min():5.1f}")
        print(f"   braking       {tr.brake.min()/9.80665:+7.2f} .. "
              f"{tr.brake.max()/9.80665:+7.2f} g  (grade removed)")
        lean = np.degrees(np.arccos(np.clip(1.0 / np.maximum(tr.gload, 1.0), -1, 1)))
        print(f"   |a| peak      {tr.gload.max():7.2f} g  -> lean {lean.max():.0f}°")
        if tr.dur_s is not None:
            print(f"   through corner: {tr.dur_s:.2f} s")
    if ALIGN == "gates" and all(t.dur_s for t in traces):
        a, b = traces[0], traces[1]
        print("-" * 70)
        print(f"   traversal difference: {a.dur_s - b.dur_s:+.2f} s "
              f"({a.label} minus {b.label})")
        print("   NOTE: gates are hand-picked at ~1 Hz. Anything under ~1 s")
        print("   is inside the error. Compare shape, not speed.")
    print("=" * 70)

    setup()
    fig, (ax1, ax2) = figure(nrows=2, height=7.2, sharex=True)
    for tr in traces:
        ax1.plot(tr.x, tr.roll, color=tr.color, label=tr.label, lw=2.6)
        ax2.plot(tr.x, tr.brake / 9.80665, color=tr.color, label=tr.label, lw=2.6)

    for ax in (ax1, ax2):
        ax.axhline(0, color=C.TEXT_3, lw=1.1, zorder=0)
        if ALIGN == "mark":
            ax.axvline(0, color=C.BORDER, lw=1.2, ls="--", zorder=0)

    ax1.set_ylabel("Roll rate (deg/s)")
    ax2.set_ylabel("Braking (g)")
    ax2.set_xlabel("Corner traversal (%)" if ALIGN == "gates"
                   else "Time relative to mark (s)")

    # Direction cues, so the reader does not have to decode the sign.
    ax1.annotate("leaning in", xy=(-0.075, 0.80), xycoords="axes fraction",
                 rotation=90, ha="center", va="center", fontsize=9.5,
                 color=C.TEXT_2)
    ax1.annotate("standing up", xy=(-0.075, 0.20), xycoords="axes fraction",
                 rotation=90, ha="center", va="center", fontsize=9.5,
                 color=C.TEXT_2)
    ax2.annotate("slowing", xy=(-0.075, 0.20), xycoords="axes fraction",
                 rotation=90, ha="center", va="center", fontsize=9.5,
                 color=C.TEXT_2)

    ax1.legend(loc="upper right")

    fig.text(0.5, -0.015,
             f"zero-phase Butterworth low-pass {LPF_HZ:g} Hz  ·  "
             f"braking = longitudinal minus {BASELINE_HZ:g} Hz grade baseline  ·  "
             f"{traces[0].src} vs {traces[1].src}",
             ha="center", va="top", fontsize=9, color=C.TEXT_3,
             family="monospace")
    save(fig, OUT)


if __name__ == "__main__":
    main()

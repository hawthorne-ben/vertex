"""
Three descents, one segment, three levels of commitment.

Golden Gate Bridge north side down to Fort Baker, 2026-09-07. Same rider, same
bike, same road, minutes apart. See
`data/segments/2026-09-07_ggb_north_descents.md`.

The argument: **nothing here needs to know which way is down.** No orientation,
no integration, no fused attitude — the quantity that failed on V1. Only rates
and accelerometer magnitude, both immune to the drift that made absolute
attitude unrecoverable.

X-axis is percent-of-descent, not seconds. The runs took 79 / 58 / 53 s, so
aligning on elapsed time would show a faster run as a compressed copy of a
slower one. Normalising to traversal asks the useful question instead: at the
same *place* on the road, what was the rider doing?

    ../venv-analysis/bin/python descent_compare.py
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy.signal import butter, filtfilt

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent / "packages/vtx-parser/python"))
sys.path.insert(0, str(_HERE))

from plot_style import C, figure, save, setup  # noqa: E402
from vtx_parser import decode_vtx  # noqa: E402

SRC = "data/sample-recordings/9_7_2026_33823744.vtx"
FIT = "/tmp/fit_9_7.json"   # from web/fitdump.mjs — the same fit-file-parser
                            # the production API uses, force:true to tolerate
                            # the malformed developer field Garmin writes

LPF_HZ = 0.35       # zero-phase; cornering and braking are well under 1 Hz
BASELINE_HZ = 0.05  # grade baseline, subtracted to isolate braking
PAD_S = 25.0        # filtered either side, then trimmed — no edge transients
GRID = 400          # resample points across the descent

# Align on DISTANCE, not elapsed time. Time-normalisation assumes both runs
# covered ground at proportionally the same rate — that a run 9% faster overall
# was 9% faster everywhere. It was not: speed gains concentrate on the straights,
# not in the corners, so the mapping from time-fraction to distance-fraction
# diverges and features drift apart toward the end of the descent. Distance is
# physical: the same corner lands at the same x for every run by construction.
# Measured gate lengths: 604.5 / 601.5 / 594.5 m — within 1.7%.


@dataclass
class Run:
    label: str
    color: str
    top_s: float
    bottom_s: float


RUNS = [
    Run("1 — hesitant",  C.SECONDARY, 1890, 1969),   # 79 s
    Run("2 — moderate",  C.ORANGE,    2553, 2611),   # 58 s
    Run("3 — committed", C.CONTRAST,  3017, 3070),   # 53 s
]


def lowpass(x, fs, hz, order=4):
    b, a = butter(order, hz / (fs / 2), btype="low")
    return filtfilt(b, a, x)


@dataclass
class Trace:
    label: str
    color: str
    pct: np.ndarray
    roll: np.ndarray     # gyro_x, deg/s — lean rate
    yaw: np.ndarray      # gyro_z, deg/s — heading change
    brake: np.ndarray    # accel_x minus grade baseline, g
    gload: np.ndarray    # |a| in g
    dur_s: float


def fit_distance_lookup():
    """Interpolator from device-clock seconds to metres travelled."""
    import json
    fit = json.load(open(FIT))
    ft = np.array([r["t"] for r in fit], dtype=np.float64)
    fd = np.array([r["d"] for r in fit], dtype=np.float64)
    ok = np.isfinite(fd)
    return ft[ok], fd[ok]


def load(run: Run, recs, t, fs, t0_ms, ft, fd) -> Trace:
    plo = max(np.searchsorted(t, run.top_s - PAD_S), 0)
    phi = min(np.searchsorted(t, run.bottom_s + PAD_S), len(t))
    lo = np.searchsorted(t, run.top_s)
    hi = np.searchsorted(t, run.bottom_s)
    keep = slice(lo - plo, hi - plo)

    col = lambda n: np.array([getattr(r, n) for r in recs[plo:phi]], dtype=np.float64)
    ax, ay, az = col("accel_x"), col("accel_y"), col("accel_z")
    gx, gz = col("gyro_x"), col("gyro_z")

    roll = lowpass(gx, fs, LPF_HZ)[keep]
    yaw = lowpass(gz, fs, LPF_HZ)[keep]
    # accel_x carries grade + braking superimposed: on a descent gravity
    # projects onto the forward axis as -g*sin(theta), ~1 m/s^2 at 10%. Grade
    # changes slowly, braking does not, so subtracting a very slow baseline
    # leaves the braking signal.
    brake = ((lowpass(ax, fs, LPF_HZ) - lowpass(ax, fs, BASELINE_HZ)) / 9.80665)[keep]
    # |a| is orientation-free. Filter each axis only enough to kill road
    # vibration, take the magnitude, then smooth — hard-filtering the axes
    # before combining smooths away the peak the magnitude should capture.
    mag = np.sqrt(lowpass(ax, fs, 5.0) ** 2 + lowpass(ay, fs, 5.0) ** 2
                  + lowpass(az, fs, 5.0) ** 2)
    gload = (lowpass(mag, fs, LPF_HZ) / 9.80665)[keep]

    tt = t[lo:hi]
    dur = float(tt[-1] - tt[0])

    # Metres travelled at each IMU sample, from the paired FIT track.
    dist = np.interp(t0_ms + tt * 1000.0, ft, fd)
    dist = dist - dist[0]
    grid = np.linspace(0, float(dist[-1]), GRID)
    interp = lambda v: np.interp(grid, dist, v)

    return Trace(run.label, run.color, grid, interp(roll), interp(yaw),
                 interp(brake), interp(gload), dur)


def main():
    v = decode_vtx((_HERE / SRC).read_bytes())
    recs = v.records
    ts = np.array([r.timestamp for r in recs], dtype=np.float64)
    t = (ts - ts[0]) / 1000.0
    d = np.diff(t); fs = 1.0 / float(np.median(d[d > 0]))

    ft, fd = fit_distance_lookup()
    traces = [load(r, recs, t, fs, ts[0], ft, fd) for r in RUNS]

    print("=" * 72)
    for tr in traces:
        print(f"{tr.label}   {tr.dur_s:.0f} s")
        print(f"   roll rate   peak |{np.abs(tr.roll).max():5.1f}| deg/s"
              f"   p95 {np.percentile(np.abs(tr.roll), 95):5.1f}")
        print(f"   braking     peak {tr.brake.min():+6.3f} g"
              f"   time slowing {100*np.mean(tr.brake < -0.02):4.0f}% of descent")
        print(f"   |a| peak    {tr.gload.max():5.3f} g"
              f"   -> lean {np.degrees(np.arccos(1/max(tr.gload.max(),1))):4.1f} deg")
    print("=" * 72)

    setup()
    fig, (a1, a2) = figure(nrows=2, height=7.2, sharex=True)
    for tr in traces:
        a1.plot(tr.pct, tr.roll, color=tr.color, label=f"{tr.label}  ({tr.dur_s:.0f} s)", lw=2.2)
        a2.plot(tr.pct, tr.gload, color=tr.color, lw=2.2)

    a1.axhline(0, color=C.BORDER, lw=1.0, zorder=0)
    a2.axhline(1.0, color=C.TEXT_3, lw=1.2, ls=":", zorder=0)
    a2.annotate("1 g — upright", xy=(0.01, 1.0), xycoords=("axes fraction", "data"),
                va="bottom", fontsize=9.5, color=C.TEXT_2)

    # Tight to the data: the interesting range is 1.00-1.16 g, and a y-axis
    # running to zero renders the whole panel as a flat line.
    hi = max(t.gload.max() for t in traces)
    a2.set_ylim(0.96, hi + 0.02)
    axl = a2.twinx()
    axl.set_ylim(a2.get_ylim())
    ticks = [g for g in (1.0, 1.05, 1.10, 1.15) if g <= hi + 0.02]
    axl.set_yticks(ticks)
    axl.set_yticklabels([f"{np.degrees(np.arccos(1.0/g)):.0f}°" for g in ticks])
    axl.set_ylabel("implied lean", color=C.TEXT_2)
    axl.tick_params(colors=C.TEXT_2)
    axl.grid(False)
    for sp in axl.spines.values():
        sp.set_visible(False)

    a1.set_ylabel("Roll rate (deg/s)\nleaning")
    a2.set_ylabel("Total load (g)\ncornering force")
    a2.set_xlabel("Distance from top gate (m)  —  604 / 602 / 595 m, 79 / 58 / 53 s")
    a1.set_title("Same 600 m, three levels of commitment — rates only, no orientation",
                 loc="left")
    a1.legend(loc="upper right", fontsize=10)

    fig.text(0.5, -0.012,
             f"GGB north → Fort Baker · 2026-09-07 · {SRC.split('/')[-1]} · "
             f"distance-aligned via paired FIT · zero-phase LPF {LPF_HZ:g} Hz",
             ha="center", va="top", fontsize=8.5, color=C.TEXT_3, family="monospace")
    save(fig, "04_descent_compare")


if __name__ == "__main__":
    main()

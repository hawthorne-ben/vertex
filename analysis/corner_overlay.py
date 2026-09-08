"""
Corner overlay — two descents through the same corner, apex-aligned.

The payoff visual for the presentation's "measure the difference, not the
absolute" argument. Two runs, same corner, plotted on a shared axis centred on
the apex so the difference in commitment is visible in both magnitude and
timing.

WORKFLOW
--------
1. Put two .vtx files somewhere and note a rough timestamp for the corner in
   each (from the web UI map slider — anything within a few seconds is fine).
2. Edit the RUNS block at the bottom.
3. Run it. It prints where it found each apex and writes a chart.
4. Look at the chart. Nudge `shift_s` on either run until the traces line up
   the way you want. Re-run. Repeat.

    ../venv-analysis/bin/python corner_overlay.py

APEX DETECTION
--------------
The apex is taken as the peak of |lateral accel| combined with |roll rate| —
in a corner both spike together, which discriminates a real turn from a bump
(accel only) or a steering correction (gyro only). Detection runs inside a
search window around your rough timestamp, so a loose mark is fine.

Set `apex_mode="manual"` on a run to use your timestamp verbatim instead.

FILTERING
---------
Road vibration lives at 40-100 Hz. A low-pass at ~5 Hz removes it while
leaving cornering dynamics (well under 2 Hz) untouched. Zero-phase filtfilt,
so event timing is not shifted — important when the whole point is comparing
*when* things happen.

UNITS
-----
Gyro is deg/s in both hardware generations. Accel is m/s^2; lateral accel is
also shown in g since that is how cornering load is normally discussed.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, Optional

import numpy as np
from scipy.signal import butter, filtfilt

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent / "packages/vtx-parser/python"))
sys.path.insert(0, str(_HERE))

from plot_style import C, figure, save, setup, stamp  # noqa: E402
from vtx_parser import decode_vtx  # noqa: E402


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


@dataclass
class Run:
    """One descent through the corner."""

    path: str
    label: str
    # Rough time of the corner. Either seconds from the start of the recording,
    # or a unix-ms timestamp copied from the web UI — both are accepted.
    corner_at: float
    color: str = C.PRIMARY
    # Nudge this after looking at the chart. Positive shifts the trace right.
    shift_s: float = 0.0
    # "auto" finds the apex by peak cornering load near corner_at.
    # "manual" uses corner_at verbatim.
    apex_mode: Literal["auto", "manual"] = "auto"
    # How far either side of corner_at to hunt for the apex.
    search_s: float = 8.0


@dataclass
class Config:
    window_s: float = 5.0        # seconds shown either side of the apex
    # Accel is noisier than gyro (road vibration couples in harder), so it
    # gets a tighter cutoff. Cornering dynamics live well under 2 Hz, so even
    # 2.5 Hz preserves everything that matters.
    lowpass_accel_hz: float = 2.5
    lowpass_gyro_hz: float = 5.0
    filter_order: int = 4
    out_name: str = "04_corner_overlay"
    show_yaw: bool = True        # False -> two panels, cleaner for a slide


# ---------------------------------------------------------------------------
# Loading and conditioning
# ---------------------------------------------------------------------------


@dataclass
class Trace:
    label: str
    color: str
    t: np.ndarray            # seconds, zeroed at the apex
    lat_accel: np.ndarray    # m/s^2, filtered
    roll_rate: np.ndarray    # deg/s, filtered
    yaw_rate: np.ndarray     # deg/s, filtered
    load: np.ndarray         # combined cornering load, normalised
    rate_hz: float
    apex_abs_s: float        # where the apex landed, seconds into the file
    n_raw: int
    src: str


def _lowpass(x: np.ndarray, cutoff: float, fs: float, order: int) -> np.ndarray:
    """Zero-phase low-pass. filtfilt so event timing is not shifted."""
    nyq = fs / 2.0
    if cutoff >= nyq:
        return x
    b, a = butter(order, cutoff / nyq, btype="low")
    # filtfilt needs a few times the filter length; bail out gracefully.
    if len(x) < 3 * max(len(a), len(b)):
        return x
    return filtfilt(b, a, x)


def load_run(run: Run, cfg: Config) -> Trace:
    raw = Path(run.path).read_bytes()
    vtx = decode_vtx(raw)
    recs = vtx.records
    if not recs:
        raise SystemExit(f"{run.path}: no records")

    ts = np.array([r.timestamp for r in recs], dtype=np.float64)
    # Timestamps may be ms-from-start or absolute unix ms depending on vintage.
    t = (ts - ts[0]) / 1000.0

    dt = np.diff(t)
    dt = dt[dt > 0]
    rate = 1.0 / float(np.median(dt)) if len(dt) else 104.0

    # Body frame: x forward, y lateral, z vertical.
    ay = np.array([r.accel_y for r in recs], dtype=np.float64)
    gx = np.array([r.gyro_x for r in recs], dtype=np.float64)   # roll rate
    gz = np.array([r.gyro_z for r in recs], dtype=np.float64)   # yaw rate

    ay_f = _lowpass(ay, cfg.lowpass_accel_hz, rate, cfg.filter_order)
    gx_f = _lowpass(gx, cfg.lowpass_gyro_hz, rate, cfg.filter_order)
    gz_f = _lowpass(gz, cfg.lowpass_gyro_hz, rate, cfg.filter_order)

    # Combined cornering load: lateral accel and roll rate both spike in a
    # real corner. Normalising each to its own scale keeps one from dominating.
    def norm(v):
        s = np.percentile(np.abs(v), 99)
        return np.abs(v) / s if s > 0 else np.abs(v)

    load = norm(ay_f) + norm(gx_f)

    # --- locate the apex ---
    corner_at = run.corner_at
    if corner_at > 1e9:                       # looks like unix ms
        corner_at = (corner_at - ts[0]) / 1000.0
    corner_at = float(np.clip(corner_at, t[0], t[-1]))

    if run.apex_mode == "manual":
        apex_s = corner_at
    else:
        lo = np.searchsorted(t, corner_at - run.search_s)
        hi = np.searchsorted(t, corner_at + run.search_s)
        lo, hi = max(lo, 0), min(hi, len(t))
        if hi - lo < 2:
            apex_s = corner_at
        else:
            apex_s = float(t[lo + int(np.argmax(load[lo:hi]))])

    apex_s += run.shift_s

    # --- slice the window ---
    lo = np.searchsorted(t, apex_s - cfg.window_s)
    hi = np.searchsorted(t, apex_s + cfg.window_s)
    lo, hi = max(lo, 0), min(hi, len(t))
    sl = slice(lo, hi)

    return Trace(
        label=run.label,
        color=run.color,
        t=t[sl] - apex_s,
        lat_accel=ay_f[sl],
        roll_rate=gx_f[sl],
        yaw_rate=gz_f[sl],
        load=load[sl],
        rate_hz=rate,
        apex_abs_s=apex_s,
        n_raw=len(recs),
        src=Path(run.path).name,
    )


# ---------------------------------------------------------------------------
# Plot
# ---------------------------------------------------------------------------


def plot(traces: list[Trace], cfg: Config) -> None:
    setup()
    n = 3 if cfg.show_yaw else 2
    fig, axes = figure(nrows=n, height=2.9 * n, sharex=True)
    ax_a, ax_r = axes[0], axes[1]
    ax_y = axes[2] if cfg.show_yaw else None

    G = 9.80665
    for tr in traces:
        ax_a.plot(tr.t, tr.lat_accel / G, color=tr.color, label=tr.label)
        ax_r.plot(tr.t, tr.roll_rate, color=tr.color, label=tr.label)
        if ax_y is not None:
            ax_y.plot(tr.t, tr.yaw_rate, color=tr.color, label=tr.label)

    for ax in axes:
        ax.axvline(0, color=C.TEXT_3, lw=1.2, ls="--", zorder=0)
        ax.axhline(0, color=C.BORDER, lw=1.0, zorder=0)

    ax_a.set_ylabel("Lateral accel (g)")
    ax_r.set_ylabel("Roll rate (deg/s)")
    if ax_y is not None:
        ax_y.set_ylabel("Yaw rate (deg/s)")
    axes[-1].set_xlabel("Time relative to apex (s)")
    ax_a.set_title("Same corner, two descents — aligned at peak cornering load",
                   loc="left")
    ax_a.legend(loc="upper right")
    ax_a.annotate("apex", xy=(0, 1.02), xycoords=("data", "axes fraction"),
                  ha="center", va="bottom", fontsize=10, color=C.TEXT_2)

    src = " · ".join(f"{t.src} @{t.apex_abs_s:.1f}s" for t in traces)
    fig.text(0.5, -0.012,
             f"{src} · zero-phase LPF: accel {cfg.lowpass_accel_hz:g} Hz, "
             f"gyro {cfg.lowpass_gyro_hz:g} Hz",
             ha="center", va="top", fontsize=8.5, color=C.TEXT_3,
             family="monospace")
    save(fig, cfg.out_name)


def report(traces: list[Trace], cfg: Config) -> None:
    G = 9.80665
    print("\n" + "=" * 74)
    for tr in traces:
        pk_a = np.max(np.abs(tr.lat_accel)) / G
        pk_r = np.max(np.abs(tr.roll_rate))
        print(f"{tr.label}")
        print(f"   source        {tr.src}  ({tr.n_raw:,} samples @ {tr.rate_hz:.1f} Hz)")
        print(f"   apex found at {tr.apex_abs_s:.2f} s into the file")
        print(f"   window        {tr.t[0]:+.2f} .. {tr.t[-1]:+.2f} s  ({len(tr.t)} samples)")
        print(f"   peak lateral  {pk_a:.2f} g")
        print(f"   peak roll     {pk_r:.0f} deg/s")
    if len(traces) == 2:
        a, b = traces
        da = (np.max(np.abs(a.lat_accel)) - np.max(np.abs(b.lat_accel))) / G
        print("-" * 74)
        print(f"   peak lateral difference: {da:+.2f} g  ({a.label} minus {b.label})")
    print("=" * 74)
    print("\nIf the traces do not line up, set shift_s on a run and re-run.")
    print("Positive shift_s moves that trace to the right.\n")


# ---------------------------------------------------------------------------
# EDIT THIS
# ---------------------------------------------------------------------------

CFG = Config(
    window_s=5.0,            # seconds either side of apex
    lowpass_accel_hz=2.5,    # lower = cleaner line; 2.5 keeps all cornering
    lowpass_gyro_hz=5.0,
    show_yaw=True,           # False for a two-panel version on the slide
    out_name="04_corner_overlay",
)

RUNS = [
    Run(
        path="data/sample-recordings/REPLACE_ME_run_a.vtx",
        label="Run A",
        corner_at=0.0,          # seconds into the file, or unix ms from the UI
        color=C.PRIMARY,
        shift_s=0.0,
    ),
    Run(
        path="data/sample-recordings/REPLACE_ME_run_b.vtx",
        label="Run B",
        corner_at=0.0,
        color=C.CONTRAST,
        shift_s=0.0,
    ),
]


if __name__ == "__main__":
    missing = [r.path for r in RUNS if not Path(r.path).exists()]
    if missing:
        raise SystemExit(
            "Set the paths in RUNS first. Not found:\n  " + "\n  ".join(missing)
        )
    traces = [load_run(r, CFG) for r in RUNS]
    report(traces, CFG)
    plot(traces, CFG)

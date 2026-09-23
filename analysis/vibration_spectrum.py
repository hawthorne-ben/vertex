"""
Vibration spectrum and the aliasing argument — slides 3c and 5c.

WHAT THIS CHART CAN AND CANNOT SHOW
-----------------------------------
It cannot show road vibration at 40-100 Hz, because nothing in the corpus
samples fast enough to see it. Every recording is at or below 104 Hz, so the
Nyquist limit is at or below 52 Hz. **The band that matters is above the
highest frequency any of this hardware can resolve.**

Stating that plainly is the point. The claim on the slide is not "here is the
road vibration" — it is:

    The band that matters is above what either generation could resolve, so
    its energy does not disappear, it folds back into the band I do measure.

WHAT IT DOES SHOW
-----------------
Top panel: measured spectra from both generations, plotted to their real
Nyquist limits. V1 at ~25 Hz (link-limited, so the usable band ends at
12.5 Hz) and V2 at 104 Hz (52 Hz). The V2 spectrum keeps rising toward its
limit rather than rolling off, which is what energy above the limit looks like
from below.

Bottom panel: where 40-100 Hz lands after folding. A component at frequency f
sampled at fs appears at |f - round(f/fs)*fs|. That maps the road band onto
0-52 Hz, on top of the cornering and braking signal.

The honest caveat, stated on the slide: the 40-100 Hz figure for road
vibration is from the literature and from the damping work, not measured here.
Confirming it needs a faster instrument than this project ever built.

Run:
    cd analysis && ../venv-analysis/bin/python vibration_spectrum.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from scipy.fft import rfft, rfftfreq

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent / "packages/vtx-parser/python"))
sys.path.insert(0, str(_HERE))

from plot_style import C, save, setup, shade_band  # noqa: E402
from vtx_parser import decode_vtx  # noqa: E402

import matplotlib.pyplot as plt  # noqa: E402

# One V1 and one V2 ride, both real road riding.
V1_SRC = "data/sample-recordings/merged_2026-02-22_141644-155004.vtx"
V2_SRC = "data/sample-recordings/9_13_2026_34988967.vtx"

# The road vibration band. NOT measured by this project — see module docstring.
ROAD_LO, ROAD_HI = 40.0, 100.0

# Two figures, because two slides make different claims. 3c is about what the
# hardware could see; 5c is about where what it could not see ends up. Shipping
# one two-panel figure meant 3c's slide showed a panel that answers 5c.
OUT_SPECTRA = "03c_vibration_spectrum"
OUT_FOLDING = "05c_nyquist_folding"


def spectrum(path: str, max_seconds: float = 600.0):
    """Welch-style averaged magnitude spectrum of vertical acceleration."""
    recs = decode_vtx(Path(path).read_bytes()).records
    ts = np.array([r.timestamp for r in recs], dtype=np.float64)
    d = np.diff(ts)
    d = d[d > 0]
    fs = 1000.0 / float(np.median(d))

    az = np.array([r.accel_z for r in recs], dtype=np.float64)

    # Trim to a contiguous stretch so a stop in the middle does not smear the
    # estimate. Take the longest run with no gap over 1 s.
    gaps = np.where(np.diff(ts) > 1000.0)[0]
    bounds = np.concatenate(([0], gaps + 1, [len(az)]))
    lo, hi, best = 0, len(az), 0
    for a, b in zip(bounds[:-1], bounds[1:]):
        if b - a > best:
            lo, hi, best = a, b, b - a
    az = az[lo:hi]

    n_max = int(fs * max_seconds)
    if len(az) > n_max:
        az = az[:n_max]

    # Average over half-overlapping windows: one FFT of a long ride is mostly
    # noise, and the average is what makes the shape readable.
    seg = int(min(len(az), fs * 8))
    if seg < 64:
        raise SystemExit(f"{path}: too few samples")
    win = np.hanning(seg)
    step = seg // 2
    acc = None
    count = 0
    for start in range(0, len(az) - seg + 1, step):
        x = az[start:start + seg]
        x = x - x.mean()
        mag = np.abs(rfft(x * win))
        acc = mag if acc is None else acc + mag
        count += 1
    mag = acc / max(count, 1)
    freq = rfftfreq(seg, 1.0 / fs)
    return freq, mag, fs, count


def plot_spectra(f1, m1, fs1, n1, f2, m2, fs2, n2) -> None:
    """Slide 3c — what each generation can actually resolve."""
    fig, ax = plt.subplots(figsize=(11.0, 5.4), layout="none")

    ax.semilogy(f2[1:], m2[1:], color=C.PRIMARY, lw=1.6,
                label=f"V2 — 104 Hz ODR (Nyquist {fs2/2:.0f} Hz)")
    ax.semilogy(f1[1:], m1[1:], color=C.CONTRAST, lw=1.6,
                label=f"V1 — {fs1:.0f} Hz over BLE (Nyquist {fs1/2:.0f} Hz)")

    for fs, color in ((fs1, C.CONTRAST), (fs2, C.PRIMARY)):
        ax.axvline(fs / 2, color=color, lw=1.1, ls="--", zorder=1)

    ax.set_xlim(0, ROAD_HI + 10)
    ax.set_ylim(1e-2, 3.0)
    ax.set_xlabel("Frequency (Hz)")
    ax.set_ylabel("Relative magnitude")
    # Lower right: lower left is where the "V1 stops here" label sits, and the
    # legend box covered it.
    ax.legend(loc="lower right", framealpha=0.9, fontsize=10)
    ax.grid(alpha=0.25)

    shade_band(ax, ROAD_LO, ROAD_HI, color=C.TEXT_3, alpha=0.13)
    # The band is empty on purpose — no trace reaches into it. Say so inside
    # the shading, or it reads as data that failed to load.
    ax.annotate(
        "Road vibration, 40–100 Hz\nno data — above both Nyquist limits",
        xy=((ROAD_LO + ROAD_HI) / 2, 0.55), xycoords=("data", "axes fraction"),
        ha="center", va="center", fontsize=11, color=C.TEXT_2,
        linespacing=1.5, style="italic",
    )
    # Label the two Nyquist lines rather than characterising the trace shape.
    # An earlier version said V2 was "still climbing when it runs out of
    # bandwidth" — it is not; it falls from ~20 Hz. Do not put a claim on the
    # chart that the chart disproves.
    ax.annotate(
        f"V1 stops here\n({fs1/2:.0f} Hz)",
        xy=(fs1 / 2, 0.055), xycoords=("data", "axes fraction"),
        xytext=(8, 0), textcoords="offset points",
        ha="left", va="bottom", fontsize=10, color=C.CONTRAST,
        linespacing=1.4,
    )
    ax.annotate(
        f"V2 stops here\n({fs2/2:.0f} Hz)",
        xy=(fs2 / 2, 0.055), xycoords=("data", "axes fraction"),
        xytext=(-8, 0), textcoords="offset points",
        ha="right", va="bottom", fontsize=10, color=C.PRIMARY,
        linespacing=1.4,
    )

    fig.text(0.085, 0.975,
             "Neither generation could see the band that matters",
             ha="left", va="top", fontsize=15.5, weight="600", color=C.INK)
    fig.text(0.5, 0.010,
             f"V1 {Path(V1_SRC).name} @ {fs1:.0f} Hz · "
             f"V2 {Path(V2_SRC).name} @ {fs2:.0f} Hz · vertical accel, "
             f"{n1}/{n2} averaged windows\n"
             f"40–100 Hz band is from the literature and the damping work — "
             f"not measured by this project",
             ha="center", va="bottom", fontsize=8.5, color=C.TEXT_3,
             family="monospace", linespacing=1.5)

    fig.subplots_adjust(top=0.90, bottom=0.185, left=0.085, right=0.975)
    save(fig, OUT_SPECTRA)


def plot_folding(fs1, fs2) -> None:
    """Slide 5c — where the unresolvable band lands once it aliases."""
    fig, ax = plt.subplots(figsize=(11.0, 5.4), layout="none")

    f = np.linspace(ROAD_LO, ROAD_HI, 600)
    for fs, color, label in ((fs2, C.PRIMARY, f"V2, {fs2:.0f} Hz sampling"),
                             (fs1, C.CONTRAST, f"V1, {fs1:.0f} Hz sampling")):
        folded = np.abs(f - np.round(f / fs) * fs)
        ax.plot(f, folded, color=color, lw=2.4, label=label)

    ax.set_xlim(ROAD_LO, ROAD_HI)
    ax.set_ylim(0, max(fs1, fs2) / 2 * 1.14)
    ax.set_xlabel("True frequency of the road input (Hz)")
    ax.set_ylabel("Frequency it is reported as (Hz)")
    ax.legend(loc="upper right", framealpha=0.9, fontsize=10)
    ax.grid(alpha=0.25)

    # The signal of interest lives below ~2 Hz. Anything folding into there is
    # indistinguishable from cornering and braking — no filter downstream can
    # separate them, because the information is gone by the time it is stored.
    ax.axhspan(0, 2.0, color=C.CONTRAST, alpha=0.18, lw=0, zorder=1)
    # Both labels go in the empty upper-left wedge, above V1's sawtooth and
    # below V2's descent. Anchoring either near the 100 Hz end put it on top
    # of a trace — three lines converge there.
    ax.annotate(
        "cornering and braking live here (< 2 Hz)",
        xy=(ROAD_LO + 4.0, 2.0), xytext=(30, 132),
        textcoords="offset points",
        ha="left", va="bottom", fontsize=10.5, weight="600",
        color=C.CONTRAST,
        arrowprops=dict(arrowstyle="-|>", color=C.CONTRAST, lw=1.4,
                        shrinkA=2, shrinkB=3),
    )
    # Right-aligned and pulled left: anchored at 100 Hz with a positive x
    # offset the text runs straight off the axes.
    ax.annotate(
        f"a 100 Hz input arrives as DC at {fs2:.0f} Hz",
        xy=(ROAD_HI - 0.6, 0.6), xytext=(-24, 190),
        textcoords="offset points",
        ha="right", va="bottom", fontsize=10.5, color=C.PRIMARY,
        arrowprops=dict(arrowstyle="-|>", color=C.PRIMARY, lw=1.4,
                        shrinkA=2, shrinkB=3,
                        connectionstyle="arc3,rad=0.22"),
    )

    fig.text(0.085, 0.975,
             "Where the unresolvable band actually lands",
             ha="left", va="top", fontsize=15.5, weight="600", color=C.INK)
    fig.text(0.5, 0.010,
             "Aliased frequency = |f - round(f / fs) x fs| · "
             "energy above Nyquist is not lost, it is relabelled\n"
             "The fix is an analog anti-alias filter ahead of the ADC — "
             "see the do-over slide",
             ha="center", va="bottom", fontsize=8.5, color=C.TEXT_3,
             family="monospace", linespacing=1.5)

    fig.subplots_adjust(top=0.90, bottom=0.185, left=0.085, right=0.975)
    save(fig, OUT_FOLDING)


def main() -> None:
    setup()

    f1, m1, fs1, n1 = spectrum(V1_SRC)
    f2, m2, fs2, n2 = spectrum(V2_SRC)

    # Normalise each to its own peak: the two generations have different scale
    # factors and mount stiffness, so absolute magnitudes are not comparable.
    # Shape versus frequency is the comparable thing.
    m1 = m1 / m1[1:].max()
    m2 = m2 / m2[1:].max()

    plot_spectra(f1, m1, fs1, n1, f2, m2, fs2, n2)
    plot_folding(fs1, fs2)

    print(f"\n  V1  {Path(V1_SRC).name}")
    print(f"      actual {fs1:.1f} Hz  ->  Nyquist {fs1/2:.1f} Hz")
    print(f"  V2  {Path(V2_SRC).name}")
    print(f"      actual {fs2:.1f} Hz  ->  Nyquist {fs2/2:.1f} Hz")
    print(f"\n  Road band {ROAD_LO:.0f}-{ROAD_HI:.0f} Hz is above both limits.")
    print("  Nothing in the corpus samples fast enough to observe it directly.\n")


if __name__ == "__main__":
    main()

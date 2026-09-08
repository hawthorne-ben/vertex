"""
Plotting helpers for the SpaceX presentation charts.

Every figure in the deck should go through this module so styling stays
consistent: same palette, same fonts, same export settings, transparent
backgrounds that drop onto any slide.

Typical use:

    from plot_style import setup, figure, save, C

    setup()
    fig, ax = figure()
    ax.plot(t, accel_z, color=C.PRIMARY, label="accel_z")
    ax.set(xlabel="Time (s)", ylabel="Acceleration (m/s$^2$)")
    ax.legend()
    save(fig, "03_raw_accel")

Colors come from the web app theme (web/src/app/globals.css chart-1..5),
so charts, slides, and the live dashboard read as one system.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional, Sequence, Tuple

import matplotlib as mpl
import matplotlib.pyplot as plt

_HERE = Path(__file__).resolve().parent
_STYLE = _HERE / "vertex.mplstyle"

# Where finished slide assets land.
FIGURES_DIR = _HERE / "figures"


class C:
    """Theme colors, hex, from the web app's CSS custom properties."""

    # chart-1..5
    SLATE = "#274754"     # chart-3 — primary series, deepest value
    RED = "#E76E50"       # chart-1 — contrast / "bad" series
    TEAL = "#2A9D90"      # chart-2 — secondary series
    ORANGE = "#F4A462"    # chart-5
    SAND = "#E8C468"      # chart-4

    # Semantic aliases — prefer these in plot code so intent is readable.
    PRIMARY = SLATE
    CONTRAST = RED
    SECONDARY = TEAL

    # Status colors
    SUCCESS = "#16A249"
    WARNING = "#F59F0A"
    ERROR = "#EF4343"
    INFO = "#0A7AAE"

    # Neutrals
    INK = "#0A0A0A"
    TEXT_2 = "#737373"
    TEXT_3 = "#A3A3A3"
    BORDER = "#E5E5E5"

    # Axis triples for 3-axis IMU plots (x/y/z), consistent everywhere.
    XYZ = (SLATE, RED, TEAL)


def setup() -> None:
    """Apply the Vertex style. Call once at the top of every plot script."""
    plt.style.use(str(_STYLE))
    # Minus sign that renders in all fonts (matplotlib's default U+2212 is
    # missing from some mono faces and shows as a box).
    mpl.rcParams["axes.unicode_minus"] = False


def figure(
    nrows: int = 1,
    ncols: int = 1,
    width: float = 10.0,
    height: Optional[float] = None,
    **kwargs,
):
    """
    Create a figure sized for a slide.

    Defaults to 10 x 5.5in (2000 x 1100px at save time), which fills a
    16:9 slide's content area with room for a title above.

    Returns (fig, ax) for a single plot, or (fig, axes) for a grid.
    """
    if height is None:
        height = 5.5 if nrows == 1 else 2.6 * nrows
    fig, axes = plt.subplots(
        nrows, ncols, figsize=(width, height), squeeze=True, **kwargs
    )
    return fig, axes


def save(fig, name: str, subdir: str = "", also_pdf: bool = False,
         transparent: bool = False) -> Path:
    """
    Save a figure into analysis/figures/.

    Args:
        name: filename stem. Prefix with the slide number for ordering,
            e.g. "03_raw_accel", "06_size_comparison".
        subdir: optional subdirectory under figures/.
        also_pdf: additionally write a vector PDF (useful for diagrams that
            may be scaled up, or for print).
        transparent: pass True for the final slide asset so it drops onto any
            slide background. Default False writes an opaque white background,
            which is what you want while reviewing — a transparent PNG in a
            dark image viewer makes the dark series invisible.

    Returns the PNG path.
    """
    out_dir = FIGURES_DIR / subdir if subdir else FIGURES_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    kw = dict(transparent=True) if transparent else dict(
        transparent=False, facecolor="white", edgecolor="none")

    png = out_dir / f"{name}.png"
    fig.savefig(png, **kw)
    if also_pdf:
        fig.savefig(out_dir / f"{name}.pdf", **kw)

    print(f"  wrote {png.relative_to(_HERE.parent)}")
    return png


# ---------------------------------------------------------------------------
# Annotation helpers — these are the things Sheets/Excel cannot do.
# ---------------------------------------------------------------------------


def shade_band(
    ax,
    lo: float,
    hi: float,
    label: Optional[str] = None,
    color: str = C.RED,
    alpha: float = 0.12,
    axis: str = "x",
):
    """
    Shade a frequency or time band.

    Used for the 40-100Hz road vibration band on the FFT, and for marked
    rider-state segments on the controlled-ride plots.
    """
    span = ax.axvspan if axis == "x" else ax.axhspan
    span(lo, hi, color=color, alpha=alpha, lw=0, zorder=0)
    if label:
        mid = (lo + hi) / 2
        if axis == "x":
            ax.annotate(
                label,
                xy=(mid, 0.96),
                xycoords=("data", "axes fraction"),
                ha="center",
                va="top",
                fontsize=10.5,
                color=color,
                weight="600",
            )
        else:
            ax.annotate(
                label,
                xy=(0.99, mid),
                xycoords=("axes fraction", "data"),
                ha="right",
                va="center",
                fontsize=10.5,
                color=color,
                weight="600",
            )


def mark_line(
    ax,
    value: float,
    label: str,
    axis: str = "x",
    color: str = C.TEXT_2,
    style: str = "--",
):
    """
    Draw a labeled reference line.

    Used for the Nyquist frequency (52Hz), gyro saturation rails, and the
    "true horizontal" reference on the drift plot.
    """
    line = ax.axvline if axis == "x" else ax.axhline
    line(value, color=color, linestyle=style, linewidth=1.5, zorder=1)
    if axis == "x":
        ax.annotate(
            label,
            xy=(value, 1.005),
            xycoords=("data", "axes fraction"),
            ha="center",
            va="bottom",
            fontsize=10,
            color=color,
        )
    else:
        ax.annotate(
            label,
            xy=(1.005, value),
            xycoords=("axes fraction", "data"),
            ha="left",
            va="center",
            fontsize=10,
            color=color,
        )


def callout(ax, xy: Tuple[float, float], text: str, xytext: Tuple[float, float],
            color: str = C.INK):
    """
    Arrow-and-text annotation. Use for the 'coasting gap', saturation events,
    and the moment fusion output diverges from truth.
    """
    ax.annotate(
        text,
        xy=xy,
        xytext=xytext,
        fontsize=11,
        color=color,
        weight="500",
        arrowprops=dict(arrowstyle="->", color=color, lw=1.4,
                        connectionstyle="arc3,rad=-0.2"),
        bbox=dict(boxstyle="round,pad=0.4", fc="white", ec=C.BORDER, alpha=0.9),
    )


def stamp(fig, text: str):
    """
    Small provenance note in the figure corner — source file, date, sample
    count. Cheap credibility: every chart says where its data came from.
    """
    fig.text(0.99, 0.01, text, ha="right", va="bottom",
             fontsize=8.5, color=C.TEXT_3, family="monospace")


def label_axes(ax, xlabel: str, ylabel: str, title: Optional[str] = None):
    """Set labels with units. Every axis in the deck must carry units."""
    ax.set_xlabel(xlabel)
    ax.set_ylabel(ylabel)
    if title:
        ax.set_title(title, loc="left")


# ---------------------------------------------------------------------------
# Data loading passthrough
# ---------------------------------------------------------------------------


def load(path: str):
    """
    Load a .vtx file via the existing parser (analysis/scripts/load_vtx.py).

    Returns the dict that load_vtx_file produces:
        {'header': {...}, 'metadata': {...}, 'samples': DataFrame}

    UNITS: gyro columns are **deg/s** in BOTH hardware generations.
    V2 (LSM6DS3): GYRO_SCALE = 0.035 deg/s per LSB, no radian conversion.
    V1 (BNO055): Adafruit VECTOR_GYROSCOPE returns raw/16.0, also deg/s.
    Older docs labeled these rad/s; that was always wrong. Never apply a
    180/pi conversion to gyro data from either generation.
    """
    import sys

    sys.path.insert(0, str(_HERE / "scripts"))
    from load_vtx import load_vtx_file  # noqa: E402

    return load_vtx_file(path)


if __name__ == "__main__":
    # Smoke test: render a swatch sheet so you can eyeball the palette
    # against the slide template before committing to it.
    setup()
    fig, ax = figure(height=3.2)
    names = [
        ("PRIMARY / slate", C.SLATE),
        ("CONTRAST / red", C.RED),
        ("SECONDARY / teal", C.TEAL),
        ("orange", C.ORANGE),
        ("sand", C.SAND),
        ("text-2", C.TEXT_2),
    ]
    for i, (label, color) in enumerate(names):
        ax.barh(i, 1, color=color, height=0.72)
        ax.text(1.03, i, f"{label}  {color}", va="center",
                fontsize=11, family="monospace", color=C.INK)
    ax.set_xlim(0, 2.2)
    ax.set_ylim(-0.7, len(names) - 0.3)
    ax.axis("off")
    ax.set_title("Vertex chart palette", loc="left")
    stamp(fig, "plot_style.py")
    save(fig, "00_palette")

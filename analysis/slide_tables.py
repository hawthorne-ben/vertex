"""
Slide tables — every text table in the deck, one visual language.

`test_matrix.py` renders the validation matrix, whose look this deck settled
on: left-aligned title above a header rule, zebra-striped rows, grey footnote
block beneath. These are text tables rather than glyph marks, so they share the
styling rather than the code.

WHY RENDER TABLES AS IMAGES AT ALL
----------------------------------
Google Slides tables carry their own borders, padding, and font metrics, and
they will not match the charts sitting beside them. Rendering through
`plot_style.py` means one palette and one typeface across every asset in the
deck. It also makes them reproducible: change a number here, re-run, and the
slide updates.

The cost is that they are not editable in Slides. That is the right trade for
a deck that ships once.

LAYOUT
------
Column widths are given as fractions of the figure width and must sum to about
1. Text wraps inside its column — no manual line breaks in the data, or the
table breaks the moment a value changes length.

Run:
    cd analysis && ../venv-analysis/bin/python slide_tables.py
    cd analysis && ../venv-analysis/bin/python slide_tables.py 05a   # just one
"""

from __future__ import annotations

import sys
import textwrap
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, Sequence

import matplotlib.pyplot as plt

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))

from plot_style import C, save, setup  # noqa: E402


# ---------------------------------------------------------------------------
# Renderer
# ---------------------------------------------------------------------------


@dataclass
class Table:
    """One slide table."""

    name: str                        # output filename stem
    title: str
    cols: Sequence[str]              # header labels; "" for an unlabelled column
    widths: Sequence[float]          # fractions of width, should sum to ~1
    rows: Sequence[Sequence[str]]
    footnote: str = ""
    # Columns rendered in the accent colour rather than ink. Used for the
    # "after" side of a before/after comparison.
    accent_cols: Sequence[int] = field(default_factory=tuple)
    # Columns rendered in monospace — register names, hex values, code.
    mono_cols: Sequence[int] = field(default_factory=tuple)
    row_h: float = 0.62              # inches per row, before wrapping
    fontsize: float = 12.5
    width: float = 9.6


def _esc(text: str) -> str:
    """
    Escape dollar signs. Matplotlib reads a $...$ pair as mathtext, so
    "~$400 to under $200" renders as italic run-together nonsense. Every
    money value in this deck needs this.
    """
    return text.replace("$", r"\$")


def _wrap(text: str, col_w_in: float, fontsize: float) -> list[str]:
    """
    Wrap to fit a column. Character budget is approximate — matplotlib gives no
    cheap way to measure text before drawing, and the estimate below is tuned
    for this deck's face at 12.5 pt. Erring narrow is safe; erring wide
    overruns into the next column.
    """
    if not text:
        return [""]
    chars = max(int(col_w_in * 125.0 / fontsize), 8)
    return textwrap.wrap(text, chars) or [""]


def render(t: Table) -> Path:
    setup()

    total_w = sum(t.widths)
    widths = [w / total_w for w in t.widths]
    # Left edge of each column, in axis units 0..1.
    edges = [sum(widths[:i]) for i in range(len(widths))]

    # Wrap every cell first, so row heights follow content.
    wrapped: list[list[list[str]]] = []
    for row in t.rows:
        cells = [
            _wrap(str(v), widths[j] * t.width * 0.92, t.fontsize)
            for j, v in enumerate(row)
        ]
        wrapped.append(cells)
    line_counts = [max(len(c) for c in cells) for cells in wrapped]

    header_h = 0.52 if any(t.cols) else 0.10
    body_h = sum(0.30 + 0.24 * n for n in line_counts)
    # Count footnote lines after wrapping, not before — a long single line
    # becomes several and the figure has to grow to fit them.
    foot_lines = sum(
        len(_wrap(para, t.width * 0.97, 10.5))
        for para in t.footnote.split("\n")
    ) if t.footnote else 0
    foot_h = 0.30 + 0.22 * foot_lines if t.footnote else 0.20
    fig_h = 0.85 + header_h + body_h + foot_h

    # layout="none": vertex.mplstyle turns on constrained layout, which
    # discards the tight margins these tables set below.
    fig, ax = plt.subplots(figsize=(t.width, fig_h), layout="none")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, fig_h)
    ax.axis("off")

    y = fig_h - 0.18
    ax.text(0, y, t.title, ha="left", va="top", fontsize=16, weight="600",
            color=C.INK)
    y -= 0.62

    if any(t.cols):
        for j, cname in enumerate(t.cols):
            if cname:
                ax.text(edges[j], y, cname, ha="left", va="top",
                        fontsize=12.5, weight="600", color=C.INK)
        y -= 0.34
    ax.plot([0, 1], [y, y], color=C.BORDER, lw=1.2, zorder=1)
    y -= 0.12

    for i, (cells, nlines) in enumerate(zip(wrapped, line_counts)):
        h = 0.30 + 0.24 * nlines
        if i % 2 == 0:
            ax.axhspan(y - h, y, xmin=0, xmax=1, color=C.BORDER,
                       alpha=0.20, lw=0, zorder=0)
        for j, lines in enumerate(cells):
            color = C.CONTRAST if j in t.accent_cols else C.INK
            fam = "monospace" if j in t.mono_cols else None
            ax.text(edges[j], y - 0.17, _esc("\n".join(lines)), ha="left",
                    va="top", fontsize=t.fontsize, color=color, zorder=3,
                    linespacing=1.45, family=fam)
        y -= h

    if t.footnote:
        # Wrap to the figure width. A long footnote silently runs off the
        # right edge otherwise — matplotlib does not clip or warn.
        foot = "\n".join(
            line
            for para in t.footnote.split("\n")
            for line in _wrap(para, t.width * 0.97, 10.5)
        )
        ax.text(0, y - 0.22, _esc(foot), ha="left", va="top", fontsize=10.5,
                color=C.TEXT_3, linespacing=1.6)

    fig.subplots_adjust(top=0.995, bottom=0.005, left=0.012, right=0.988)
    return save(fig, t.name)


# ---------------------------------------------------------------------------
# The tables
# ---------------------------------------------------------------------------

TABLES: list[Table] = [

    # -- slide 1b ---------------------------------------------------------
    Table(
        name="01b_timeline_table",
        title="Eleven months, two hardware generations, one engineer",
        cols=["When", "What"],
        widths=[0.26, 0.74],
        rows=[
            ["Oct 2025", "Project start — 84 commits in month one"],
            ["Oct 2025 – Jan 2026",
             "V1: ESP32 + BNO055, onboard fusion, BLE streaming"],
            ["2026-01-06",
             'Last V1 firmware commit: "fusion experiments" — '
             "the approach abandoned"],
            ["2026-02-28", "V2 build and firmware begin"],
            ["Mar 2026", "WiFi sync, axis remap, async processing"],
            ["2026-05-14", "V2 firmware settles"],
            ["Aug–Sep 2026",
             "Dashboard, docs, clock sync, test suite, diagnostic log"],
        ],
        footnote="Dates from git. Solo project — no team, no division of "
                 "responsibility.",
    ),

    # -- slide 3a ---------------------------------------------------------
    Table(
        name="03a_v1_spec",
        title="V1: ESP32 + BNO055, onboard sensor fusion",
        cols=["", ""],
        widths=[0.26, 0.74],
        rows=[
            ["Sensor", "BNO055, 9-DoF, onboard fusion"],
            ["Rate", "25 Hz"],
            ["Transport", "BLE streaming"],
            ["Output", "Fused orientation (roll / pitch / yaw)"],
        ],
        footnote="The rate is what the link sustained, not what the sensor "
                 "could do.",
    ),

    # -- slide 5a-0 -------------------------------------------------------
    Table(
        name="05a0_chip_comparison",
        title="Five reasons to change the chip",
        cols=["", "BNO055  (V1)", "LSM6DS3  (V2)"],
        widths=[0.24, 0.38, 0.38],
        rows=[
            ["Magnetometer", "Unreliable, disabled", "Not on the die"],
            ["Fusion", "Onboard, opaque, unavoidable", "Not on the die"],
            ["Current", "~12.3 mA", "~0.9 mA"],
            ["ODR ceiling", "100 Hz, hard cap", "1.66 kHz, I run 104 Hz"],
            ["Unit cost", "~$30", "~$7"],
        ],
        accent_cols=(2,),
        footnote="I was already running 6 DoF with fusion output unused, so V2 "
                 "drops two things I had stopped using rather than two things "
                 "I needed.\n104 Hz is a balance: enough for the sub 2 Hz "
                 "dynamics I analyse, cheap on storage and cloud DSP, and with "
                 "headroom left as a config change.",
    ),

    # -- slide 5a ---------------------------------------------------------
    Table(
        name="05a_register_config",
        title="V2: raw 6-DoF, no onboard fusion",
        cols=["Register", "Value", "Setting"],
        widths=[0.24, 0.16, 0.60],
        rows=[
            ["CTRL1_XL", "0x4C", "104 Hz, ±8 g"],
            ["CTRL2_G", "0x48", "104 Hz, ±1000 dps"],
            ["CTRL3_C", "0x44", "BDU + auto-increment"],
            ["FIFO_CTRL5", "0x26", "Continuous mode, 104 Hz"],
        ],
        mono_cols=(0, 1),
        footnote="BDU = block data update: protects against a torn read "
                 "across the high/low byte pair at 104 Hz.\n"
                 "dps = degrees per second",
    ),

    # -- slide 5a, gyro range ---------------------------------------------
    Table(
        name="05a_gyro_headroom",
        title="±1000 dps, defended with measurement",
        cols=["Percentile", "Peak |gyro|", "% of rail"],
        widths=[0.30, 0.35, 0.35],
        rows=[
            ["p50", "9.4 dps", "0.9%"],
            ["p99", "66.1 dps", "6.6%"],
            ["p99.99", "271.7 dps", "27.2%"],
            ["max", "935.0 dps", "93.5%"],
        ],
        footnote="Measured across 13.7 h / 5.1 M V2 samples. Zero samples "
                 "clipped; two exceeded 800 dps.\n"
                 "One step tighter (±500) clips 0.0006% of samples — the "
                 "pothole transients the roughness metric is built on.",
    ),

    # -- slide 8d ---------------------------------------------------------
    Table(
        name="08d_validation_layers",
        title="Different layers, different kinds of proof",
        cols=["Layer", "Claim", "Evidence"],
        widths=[0.15, 0.32, 0.53],
        rows=[
            ["Hardware", "Runs, charges, doesn't drop data",
             "6 h 43 m longest unattended recording"],
            ["Capture", "Samples land at known times",
             "33 M samples · 0.12% dropped, flagged not interpolated · "
             "~1 ms quantization · drift +20 ± 3 ppm"],
            ["Format", "Bytes survive round trip, seekable, crash-tolerant",
             "91 host tests + parser integration check, 42 real files"],
            ["Signal", "The IMU sees real physical events",
             "No gyro clipping in 13.7 h measured; lean angle recovers "
             "from |a|"],
            ["Features", "Metrics correspond to rider state",
             "3 controlled descents, monotonic ordering — partial"],
            ["Insight", "Metrics explain or predict speed",
             "Not started"],
        ],
        footnote="The bottom four are verifiable — a byte round trip either "
                 "works or it does not.\nThe top two are falsifiable: they "
                 "are hypotheses about the world, and hypotheses need "
                 "experiments.",
    ),

    # -- slide 8d, limitations --------------------------------------------
    Table(
        name="08d_limitations",
        title="What real validation would need",
        cols=["", "Have", "Need"],
        widths=[0.34, 0.33, 0.33],
        rows=[
            ["Labelled state changes", "6 standing / seated",
             "Hundreds, across riders"],
            ["Ordered trials", "3 descents, varied intent",
             "20+ per condition"],
            ["Riders", "1", "5+"],
            ["Bikes / mounts", "1", "Several"],
            ["Ground truth", "Marked in-ride", "Synced video timecode"],
            ["Held-out data", "None", "Required"],
        ],
        accent_cols=(2,),
        footnote="The two rows test different things. Transitions are "
                 "detection — a discrete event at a known time, and the "
                 "signal either shows it or does not.\nOrdered trials are "
                 "ranking — the derived metric has to sort the runs the way "
                 "intent did. Everything outside these two sessions was tuned "
                 "against my own recollection, which is circular.",
    ),

    # -- slide 9 ----------------------------------------------------------
    Table(
        name="09_v1_v2_architecture",
        title="V2 decoupled capture from delivery",
        cols=["", "V1", "V2"],
        widths=[0.20, 0.40, 0.40],
        rows=[
            ["Capture", "Streamed live over BLE",
             "Local SD, network-independent"],
            ["Timing source", "Phone packet arrival",
             "Device millis() at FIFO read"],
            ["Timing error", "Tens of ms, uncorrectable",
             "~1 ms, measured and correctable"],
            ["Session length", "10–15 min (link dropped)",
             "2–5 hours unattended"],
            ["Recovery", "Restart, merge fragments",
             "Idempotent resume on reconnect"],
            ["Sample rate", "25 Hz (link-limited)", "104 Hz (sensor-native)"],
        ],
        accent_cols=(2,),
        footnote="The component changes are consequences. The architectural "
                 "change is that V1 streamed to a phone and V2 records "
                 "locally.\nV2 did not improve timing accuracy — it made "
                 "timing measurable at all.",
    ),

    # -- slide 10 ---------------------------------------------------------
    Table(
        name="10_cost_breakdown",
        title="The design got 2.4x cheaper. My spending got 11x cheaper.",
        cols=["", "V1", "V2"],
        widths=[0.34, 0.33, 0.33],
        rows=[
            ["Hardware actually bought", "$1,161", "$105"],
            ["One working unit", "$77", "$32"],
        ],
        accent_cols=(2,),
        footnote="Fixed costs, unchanged and excluded above: Bambu A1 Mini, "
                 "PLA, soldering and heat gun, Vercel, Supabase, Claude API.\n"
                 "The gap between the two rows is not engineering. I bought V1 "
                 "like a product launch and V2 like a prototype.",
    ),

    # -- appendix: terms ---------------------------------------------------
    # The prompt asks that all but the most obvious acronyms be spelled out.
    # Two term/definition pairs per row so 20 terms fit one page. Each term
    # is also spoken in full on first use; this is the reference for anyone
    # who loses the thread mid-talk.
    Table(
        name="99_acronyms",
        title="Terms",
        cols=["", "", "", "", "", ""],
        widths=[0.085, 0.25, 0.085, 0.25, 0.085, 0.245],
        # Definitions are kept short enough to fit one line at this width —
        # a wrapped cell doubles the row height and undoes the flattening.
        rows=[
            ["IMU", "Inertial measurement unit",
             "DSP", "Digital signal processing",
             "DoF", "Degrees of freedom"],
            ["ODR", "Output data rate",
             "FIFO", "First in, first out buffer",
             "ADC", "Analog to digital"],
            ["I2C", "Inter-integrated circuit",
             "SPI", "Serial peripheral interface",
             "BLE", "Bluetooth Low Energy"],
            ["MCU", "Microcontroller unit",
             "dps", "Degrees per second",
             "ppm", "Parts per million"],
            ["LSB", "Least significant bit",
             "BDU", "Block data update",
             "NTP", "Network Time Protocol"],
            ["LPF", "Low-pass filter",
             "Nyquist", "Half the sample rate",
             "Aliasing", "Reported below Nyquist"],
            ["Fusion", "Sensors into one orientation",
             ".vtx", "My binary format",
             "", ""],
        ],
        mono_cols=(0, 2, 4),
        fontsize=10.5,
        width=11.5,
        footnote="Parts: BNO055 is the V1 sensor (9-axis, onboard fusion). "
                 "LSM6DS3 is the V2 sensor (6-axis, raw output). ESP32-S3 is "
                 "the microcontroller.\nRegisters are named as the datasheet "
                 "names them: CTRL1_XL is accelerometer control 1, CTRL2_G is "
                 "gyroscope control 2.",
    ),

    # -- slide 10, the order that dates the mistake ------------------------
    Table(
        name="10_january_order",
        title="My largest order came 17 days after I stopped",
        cols=["Date", "Event", "Amount"],
        widths=[0.22, 0.56, 0.22],
        rows=[
            ["2026-01-06", "Last V1 firmware commit: \"fusion experiments\"",
             ""],
            ["2026-01-23", "Adafruit order, 5x V1 parts to share the build",
             "$404"],
            ["2026-02-26", "First V2 order, 3x parts to prototype", "$64"],
        ],
        mono_cols=(0,),
        accent_cols=(2,),
        footnote="$404 is 35% of everything I spent on V1, placed after the "
                 "approach had already failed.\nThe money and the months have "
                 "the same cause: I committed to a design before I measured "
                 "whether it worked.",
    ),
]


def main() -> None:
    wanted = sys.argv[1:] if len(sys.argv) > 1 else None
    made = 0
    for t in TABLES:
        if wanted and not any(w in t.name for w in wanted):
            continue
        render(t)
        made += 1
    if not made:
        print("  no tables matched; available:")
        for t in TABLES:
            print(f"    {t.name}")
    else:
        print(f"\n  {made} table(s) written to analysis/figures/\n")


if __name__ == "__main__":
    main()

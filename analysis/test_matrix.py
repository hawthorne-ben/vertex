"""
Validation coverage matrix — what is proven, how, and where the gaps are.

The argument this makes is not "everything is tested." It is that coverage is
a deliberate pattern: different layers admit different kinds of proof, and the
two rows that are incomplete are the two newest features rather than neglected
ones.

Columns run isolated -> real:

  Unit         host-compiled, no hardware, no Arduino runtime (`make test`)
  Integration  firmware encoder vs. the production Python parser, field by
               field (`make integration`)
  Bench        exercised on the device with serial attached
  Field        exercised across real rides — 166 recordings, 30 M samples,
               134 h. Wrong axis remap would produce nonsense DSP output;
               a wrong format would not parse; a wrong sort key would show a
               scrambled file list. Rides validate the whole chain.

    ../venv-analysis/bin/python test_matrix.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import matplotlib.pyplot as plt

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))

from plot_style import C, save, setup  # noqa: E402

COLS = ["Unit", "Integration", "Bench", "Field"]

# ● covered · ◐ partial · ✕ blocked · · not applicable
# Third element: True adds an asterisk to the row label. Reserved for rows
# where the honest answer needs a sentence, delivered verbally rather than
# printed on the slide.
ROWS = [
    (".vtx format",               "●●●●", False),
    ("Axis remap / scaling",      "●·●●", False),
    ("Button state machine",      "●·●●", False),
    ("Filename / sort key",       "●●●●", False),
    ("Sensor path (I²C, FIFO)",   "··●●", False),
    ("Storage / capacity",        "··●●", False),
    ("Upload state machine",      "··●●", False),
    ("BLE protocol",              "·●●●", False),
    ("Header patch on power loss","●·●·", False),
    ("Clock sync",                "●●●●", False),
    ("Fault handling",            "●·✕·", True),
]

MARK = {
    "●": (C.PRIMARY, 1.0),
    "◐": (C.ORANGE, 1.0),
    "✕": (C.CONTRAST, 1.0),
    "·": (C.BORDER, 1.0),
}


def main():
    setup()
    n = len(ROWS)
    fig, ax = plt.subplots(figsize=(9.6, 0.55 * n + 2.3))

    # Explicit x positions: label column, then evenly spaced marker columns,
    # then the notes column. Fixed rather than derived so nothing collides.
    LABEL_X = 0.0
    COL_X = [3.30, 4.35, 5.40, 6.45]
    XMAX = 7.0

    for j, cname in enumerate(COLS):
        ax.text(COL_X[j], n + 0.5, cname, ha="center", va="bottom",
                fontsize=12.5, weight="600", color=C.INK)
    # Rule under the header row.
    ax.plot([LABEL_X, XMAX - 0.2], [n + 0.28, n + 0.28],
            color=C.BORDER, lw=1.2, zorder=1)

    for i, (name, marks, star) in enumerate(ROWS):
        y = n - 1 - i
        if i % 2 == 0:
            ax.axhspan(y - 0.44, y + 0.44, xmin=0, xmax=1,
                       color=C.BORDER, alpha=0.20, lw=0, zorder=0)
        ax.text(LABEL_X, y, name + (" *" if star else ""), ha="left",
                va="center", fontsize=12.5, color=C.INK, zorder=3)
        for j, m in enumerate(marks):
            color, _ = MARK[m]
            if m == "·":
                ax.plot(COL_X[j], y, marker="o", ms=5, color=color,
                        alpha=0.6, zorder=3)
            elif m == "✕":
                ax.plot(COL_X[j], y, marker="X", ms=14, color=color,
                        mew=0, zorder=3)
            elif m == "◐":
                ax.plot(COL_X[j], y, marker="o", ms=15, color=color,
                        markerfacecolor="white", mew=3.2, zorder=3)
            else:
                ax.plot(COL_X[j], y, marker="o", ms=15, color=color, zorder=3)

    ax.set_xlim(-0.15, XMAX)
    ax.set_ylim(-1.75, n + 1.25)
    ax.axis("off")

    ax.text(LABEL_X, n + 1.05, "What is validated, and how",
            ha="left", va="bottom", fontsize=16, weight="600", color=C.INK)

    # Legend drawn with the same markers rather than text glyphs — the box
    # characters were missing from the font.
    ly = -0.62
    items = [("o", C.PRIMARY, 15, "covered", False),
             ("o", C.ORANGE, 15, "partial", True),
             ("X", C.CONTRAST, 14, "blocked by hardware", False),
             ("o", C.BORDER, 5, "not applicable", False)]
    x = LABEL_X + 0.08
    for mk, col, ms, label, hollow in items:
        ax.plot(x, ly, marker=mk, ms=ms, color=col, zorder=3,
                markerfacecolor="white" if hollow else col,
                mew=3.2 if hollow else 0)
        ax.text(x + 0.22, ly, label, ha="left", va="center",
                fontsize=11, color=C.TEXT_2)
        x += 0.35 + len(label) * 0.135

    ax.text(LABEL_X, -1.12,
            "* sealed production unit — fault injection not possible without a "
            "second build\n"
            "Field = 166 recordings · 30 M samples · 134 h across two hardware "
            "generations",
            ha="left", va="top", fontsize=10.5, color=C.TEXT_3, linespacing=1.6)

    fig.tight_layout()
    save(fig, "08c_validation_matrix")


if __name__ == "__main__":
    main()

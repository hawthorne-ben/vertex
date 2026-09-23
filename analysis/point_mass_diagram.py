"""
Point mass vs. real forces — slide 2.

Left:  what a cycling computer models. Power and heart rate in, GPS speed out,
       one dot with no orientation and no forces.
Right: a free-body diagram of a bike in a sustained corner — lean angle,
       increased normal force, lateral friction, and the combined reaction the
       tyre actually carries.

The contrast is the argument: the left panel is a scalar function, the right is
a rigid body in a force balance, and everything on the right is invisible to
the left.

THE PHYSICS, so every arrow is defensible
-----------------------------------------
For a bike in a steady coordinated turn, leaned at theta from vertical:

    tan(theta) = v^2 / (g * r)          lean angle balances the moments
    N          = m * g                   vertical equilibrium, road is flat
    F_lateral  = m * v^2 / r             centripetal force, supplied by grip
    |R|        = m * g / cos(theta)      the combined reaction along the bike

That last identity is the one worth having cold: the total force the tyre and
rider carry is the static weight divided by cos of the lean angle, so it is
*speed-independent given the lean* — which is exactly why lean angle is
recoverable from |a| without knowing orientation.

DEFAULT: 30 deg lean, giving |R| = 1.155 g. Set LEAN_DEG to change it; every
label recomputes.

Run:
    cd analysis && ../venv-analysis/bin/python point_mass_diagram.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))

from plot_style import C, save, setup  # noqa: E402

import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import (  # noqa: E402
    Arc, Circle, FancyArrowPatch, Wedge,
)

LEAN_DEG = 30.0
OUT = "02_point_mass_vs_forces"


def _arrow(ax, x0, y0, x1, y1, color, lw=2.2, style="-|>", ms=14, z=5, ls="-"):
    ax.add_patch(FancyArrowPatch(
        (x0, y0), (x1, y1), arrowstyle=style, mutation_scale=ms,
        color=color, lw=lw, zorder=z, linestyle=ls,
        shrinkA=0, shrinkB=0,
    ))


def draw_point_mass(ax) -> None:
    """
    Left panel: the model a cycling computer actually has.

    No box, no pipeline diagram. A single dot and a scalar function is the
    whole content — and the emptiness of this panel next to the right one is
    the argument. Anything more drawn here dilutes it.
    """
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 10)
    ax.axis("off")

    ax.text(5, 9.3, "What a cycling computer models", ha="center", va="top",
            fontsize=13, weight="600", color=C.INK)

    # One dot, on the same ground line as the bike opposite, at the same
    # height as its centre of mass. The visual rhyme is the point: this is
    # what the whole rider-and-bike system reduces to.
    ground_y = 2.35
    ax.plot([1.2, 8.8], [ground_y, ground_y], color=C.INK, lw=2.0, zorder=3,
            solid_capstyle="butt")
    for x in np.arange(1.4, 8.8, 0.62):
        ax.plot([x, x - 0.3], [ground_y, ground_y - 0.34],
                color=C.BORDER, lw=1.4, zorder=2)

    com_y = ground_y + 3.55 * np.cos(np.radians(LEAN_DEG))
    ax.add_patch(Circle((5.0, com_y), 0.30, color=C.TEXT_2, zorder=5))
    ax.text(5.42, com_y, "$m$", ha="left", va="center", fontsize=14,
            color=C.INK)

    ax.text(5.0, com_y - 1.65,
            r"$v = f(\mathrm{power},\ \mathrm{HR},\ \mathrm{grade})$",
            ha="center", va="center", fontsize=15, color=C.INK)


def draw_free_body(ax, lean_deg: float) -> None:
    """
    Right panel: the bike and rider as a body in a force balance.

    No bicycle is drawn. Earlier versions tried one — side-on wheel, then
    head-on — and both fought the diagram: a wheel has an orientation of its
    own, and getting it wrong is more distracting than leaving it out. The
    standard physics abstraction is a lean axis from the contact patch to a
    marked centre of mass, and it is clearer than any bike I can draw here.

    Every force is drawn at its actual point of application, which is the part
    that has to be right:

        mg, m v^2 / r   act at the centre of mass
        N, F_f          act at the contact patch
        |R|             the resultant the tyre carries, along the lean axis
    """
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 10)
    ax.axis("off")

    ax.text(5, 9.3, "What is actually happening", ha="center", va="top",
            fontsize=13, weight="600", color=C.INK)

    th = np.radians(lean_deg)
    contact = np.array([6.35, 2.55])          # tyre contact patch
    L = 3.55                                   # contact patch -> centre of mass

    # The turn centre is to the LEFT, so the bike leans left and the friction
    # force at the contact patch points left too. Those two must agree: a bike
    # leaning away from the lateral force is not in balance, and anyone in the
    # room who rides will catch it.
    up = np.array([-np.sin(th), np.cos(th)])
    perp = np.array([up[1], -up[0]])
    com = contact + L * up

    # -- ground -------------------------------------------------------------
    ax.plot([1.2, 8.8], [contact[1], contact[1]], color=C.INK, lw=2.0,
            zorder=3, solid_capstyle="butt")
    for x in np.arange(1.4, 8.8, 0.62):
        ax.plot([x, x - 0.3], [contact[1], contact[1] - 0.34],
                color=C.BORDER, lw=1.4, zorder=2)

    # -- lean axis and the centre of mass -----------------------------------
    ax.plot([contact[0], com[0]], [contact[1], com[1]],
            color=C.INK, lw=3.6, zorder=5, solid_capstyle="round")

    # Centre of mass: the standard quartered marker. It echoes the single grey
    # dot on the left panel — same point, vastly more going on around it.
    m_r = 0.42
    ax.add_patch(Circle(com, m_r, facecolor="white", edgecolor=C.INK,
                        lw=2.2, zorder=6))
    for t1, t2 in ((90, 180), (270, 360)):
        ax.add_patch(Wedge(com, m_r, t1, t2, facecolor=C.INK,
                           edgecolor="none", zorder=7))
    ax.add_patch(Circle(com, m_r, facecolor="none", edgecolor=C.INK,
                        lw=2.2, zorder=8))

    # -- vertical reference and the lean angle ------------------------------
    ax.plot([contact[0], contact[0]], [contact[1], contact[1] + L + 0.35],
            color=C.TEXT_3, lw=1.3, ls=(0, (4, 4)), zorder=3)
    # Arc kept small and low on the axis. At full height its label lands in
    # the same place as |R|, which is anchored near the top of the lean axis.
    arc_d = 2.2
    ax.add_patch(Arc(contact, arc_d, arc_d, angle=0,
                     theta1=90.0, theta2=90.0 + lean_deg,
                     color=C.SECONDARY, lw=2.2, zorder=6))
    # Label INSIDE the arc, in the wedge between the lean axis and vertical.
    # Outside it lands on N, which rises from the contact patch just to the
    # right. Inside, the wedge is empty.
    mid = np.radians(90.0 + lean_deg * 0.5)
    ax.text(contact[0] + (arc_d / 2 - 0.46) * np.cos(mid),
            contact[1] + (arc_d / 2 - 0.46) * np.sin(mid),
            rf"$\theta$", ha="center", va="center",
            fontsize=14, weight="600", color=C.SECONDARY, zorder=7)
    # The numeric value goes above the vertical reference, clear of everything.
    ax.text(contact[0] + 0.12, contact[1] + L + 0.42,
            rf"${lean_deg:.0f}°$ lean", ha="left", va="bottom",
            fontsize=12, weight="600", color=C.SECONDARY, zorder=7)

    # -- forces at the centre of mass ---------------------------------------
    g_len = 1.85

    # Weight, straight down from the mass.
    _arrow(ax, com[0], com[1] - m_r, com[0], com[1] - m_r - g_len,
           C.PRIMARY, lw=2.6)
    # Left of the shaft, high up near the mass. Right lands on the lean axis,
    # low-left is |R|'s column, and below the tip is where |R| sits. This
    # pocket between the mg arrow and the mv^2/r arrow is the only clear space.
    ax.text(com[0] - 0.22, com[1] - m_r - g_len * 0.35, r"$mg$",
            ha="right", va="center", fontsize=13, weight="600",
            color=C.PRIMARY)

    # Centripetal force, horizontal, toward the turn centre. Inertial frame —
    # NOT centrifugal. Most cycling diagrams online use the rotating frame;
    # this avoids having to defend a frame choice to this audience.
    f_len = g_len * np.tan(th)
    _arrow(ax, com[0] - m_r, com[1], com[0] - m_r - f_len, com[1],
           C.SECONDARY, lw=2.6)
    ax.text(com[0] - m_r - f_len - 0.18, com[1] + 0.06,
            r"$\frac{mv^2}{r}$", ha="right", va="center", fontsize=13,
            weight="600", color=C.SECONDARY)

    # -- forces at the contact patch ----------------------------------------
    # Normal force, up. Flat road, so N = mg.
    n_x = contact[0] + 0.34
    _arrow(ax, n_x, contact[1], n_x, contact[1] + g_len, C.ORANGE, lw=2.4)
    ax.text(n_x + 0.16, contact[1] + g_len * 0.60, r"$N = mg$",
            ha="left", va="center", fontsize=12.5, weight="600",
            color=C.ORANGE)

    # Friction, the reaction supplying the centripetal force. Drawn below the
    # ground line so it does not collide with the resultant leaving the patch.
    f_y = contact[1] - 0.58
    _arrow(ax, contact[0], f_y, contact[0] - f_len, f_y, C.ORANGE, lw=2.4)
    ax.text(contact[0] - f_len - 0.18, f_y, r"$F_f$", ha="right",
            va="center", fontsize=12.5, weight="600", color=C.ORANGE)

    # -- the resultant ------------------------------------------------------
    # The headline quantity: what the tyre and rider actually carry. Drawn
    # along the lean axis, offset slightly so it reads as its own vector
    # rather than a thickening of the axis line.
    # Offset to the LEFT of the lean axis (-perp): to the right it is hidden
    # behind the axis line and collides with N. Its label goes further left
    # again, into the open space under the mv^2/r arrow.
    r_len = g_len / np.cos(th)
    base = contact - 0.30 * perp
    tip = base + r_len * up
    _arrow(ax, base[0], base[1], tip[0], tip[1], C.CONTRAST, lw=3.0)
    # Label placed relative to the arrow tip but pushed well clear on the
    # open left side, below the mv^2/r arrow and left of mg.
    lbl = tip - 0.34 * perp - 0.90 * up
    ax.text(lbl[0], lbl[1],
            rf"$|R| = \frac{{mg}}{{\cos\theta}} = {1/np.cos(th):.2f}\,g$",
            ha="right", va="center", fontsize=13, weight="600",
            color=C.CONTRAST)


def main() -> None:
    setup()
    fig, (axl, axr) = plt.subplots(1, 2, figsize=(12.6, 6.0), layout="none")

    draw_point_mass(axl)
    draw_free_body(axr, LEAN_DEG)

    for a in (axl, axr):
        a.set_aspect("equal", adjustable="box")

    # Divider, so the two panels read as a contrast rather than one scene.
    fig.add_artist(plt.Line2D([0.5, 0.5], [0.13, 0.94], color=C.BORDER,
                              lw=1.4, transform=fig.transFigure))

    # Captions at figure level so both sit on the same baseline regardless of
    # what each panel drew above them.
    th = np.radians(LEAN_DEG)
    fig.text(0.255, 0.085,
             "One scalar out. No orientation, no lean,\n"
             "no load, no idea what the bike is doing.",
             ha="center", va="top", fontsize=11, color=C.TEXT_2,
             linespacing=1.5)
    fig.text(0.755, 0.085,
             "Lean, normal load, lateral grip, and a reaction "
             f"{1/np.cos(th):.0%} of static weight.\n"
             "None of it is visible to a speed sensor.",
             ha="center", va="top", fontsize=11, color=C.TEXT_2,
             linespacing=1.5)

    fig.subplots_adjust(top=0.99, bottom=0.14, left=0.01, right=0.99,
                        wspace=0.06)
    save(fig, OUT)

    th = np.radians(LEAN_DEG)
    print(f"\n  lean angle      {LEAN_DEG:.0f}°")
    print(f"  |R| / mg        {1/np.cos(th):.3f}")
    print(f"  F_lat / mg      {np.tan(th):.3f}")
    print(f"  implied v at r=20 m   {np.sqrt(9.80665*20*np.tan(th)):.1f} m/s "
          f"({np.sqrt(9.80665*20*np.tan(th))*3.6:.0f} km/h)\n")


if __name__ == "__main__":
    main()

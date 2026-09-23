#!/usr/bin/env python3
"""
Build a local, single-file HTML prep page from the notes markdown.

Generated rather than hand-written so the page cannot drift from
`notes/firmware-deep-dive.md` — edit the markdown, re-run this, reload.

    ../venv-analysis/bin/python prep_page.py        # writes notes/prep.html
    ../venv-analysis/bin/python prep_page.py --open # ...and opens it

No dependencies beyond the standard library, no network at runtime: the page
is self-contained and works from file://. Checkbox state persists in
localStorage, keyed by heading text, so re-running this script does not reset
your progress unless a heading is renamed.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "notes/firmware-deep-dive.md"
SCRIPT = ROOT / "notes/presentation-script.md"
OUT = ROOT / "notes/prep.html"

# Palette lifted from analysis/plot_style.py so the page matches the figures.
CSS_VARS = {
    "slate": "#274754",
    "red": "#E76E50",
    "teal": "#2A9D90",
    "orange": "#F4A462",
    "sand": "#E8C468",
    "success": "#16A249",
    "warning": "#F59F0A",
    "ink": "#0A0A0A",
    "text2": "#737373",
    "text3": "#A3A3A3",
    "border": "#E5E5E5",
}

# The two-day plan. Kept here rather than in the markdown because it is a
# scheduling artifact, not reference material — it changes as the days do.
PLAN = [
    ("Day 1 — Monday", [
        ("Part 0 refresher, then Parts 1-3 (the course)", "90m", "deep"),
        ("write-1 and write-2 — warm up the syntax", "45m", "cpp"),
        ("Part 4, read all twelve out loud", "60m", "deep"),
        ("Rehearsal: two full runs, untimed", "120m", "talk"),
    ]),
    ("Day 2 — Tuesday", [
        ("write-3 and write-4 — the hard two", "60m", "cpp"),
        ("fix-1 to fix-3 — debug reasoning", "30m", "cpp"),
        ("Cold-call: shuffle the twelve, no notes", "45m", "deep"),
        ("Rehearsal: two timed runs", "90m", "talk"),
        ("Skim cues only. Stop by 8pm.", "30m", "talk"),
    ]),
]

# The C++ drills, mirrored from firmware/test/drills/drill.py.
DRILLS = [
    ("write", "write-1", "logSkipPartialLine",
     "Forward scan, return an index. Warm up here."),
    ("write", "write-2", "logTrimToLastLine",
     "Reverse iteration with an unsigned counter — the classic trap."),
    ("write", "write-3", "logPlanRead",
     "Unsigned subtraction, three branches. The most interview-like."),
    ("write", "write-4", "logPlaceLine",
     "Struct return, wrap arithmetic, one nasty boundary."),
    ("fix", "fix-1", "off-by-one",
     "A boundary comparison. 1 test fails."),
    ("fix", "fix-2", "wrong comparison",
     "Looks right, is not. 1 test fails."),
    ("fix", "fix-3", "dropped wrap",
     "Subtle — only 2 of 91 fail. Narrow signal."),
]

RISKS = [
    ("Partial object on a dropped upload",
     "No DB record is created, so it is orphaned rather than corrupting. "
     "Name it before they find it.", "warning"),
    ("Torn write inside patchHeader()",
     "One trial, and it landed on a patch boundary. Unobserved, not disproven.",
     "warning"),
    ("400 Hz anti-alias at 104 Hz sampling",
     "Reset default, never changed. Real defect, on the do-over slide.", "red"),
    ("Upload state machine is untested",
     "91 tests cover format and logic. None cover WiFi. Say so first.",
     "warning"),
    ("NimBLE dies at 80 MHz",
     "Not root-caused. Costs ~32 mA. Have the hypothesis ready.", "warning"),
    ("FIFO overrun flag is never checked",
     "FIFO_STATUS2 carries OVER_RUN; the code masks it off with & 0x07. A long "
     "stall would lose samples silently. Unhandled, not a tradeoff.", "red"),
]


def md_inline(s: str) -> str:
    """Bold, code, and em-dash-safe inline markdown. Escapes first."""
    s = html.escape(s)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<em>\1</em>", s)
    return s


def slugify(s: str) -> str:
    s = re.sub(r"<[^>]+>", "", s)
    s = re.sub(r"[^\w\s-]", "", s.lower())
    return re.sub(r"[\s_]+", "-", s).strip("-")


class Block:
    """One rendered chunk of markdown, plus where it belongs in the nav."""

    def __init__(self, html_: str, level: int = 0, title: str = "",
                 slug: str = ""):
        self.html = html_
        self.level = level
        self.title = title
        self.slug = slug


def render(md: str) -> list[Block]:
    """Markdown subset -> blocks. Handles what the source actually uses."""
    blocks: list[Block] = []
    lines = md.splitlines()
    i = 0
    para: list[str] = []

    def flush_para() -> None:
        nonlocal para
        if para:
            text = " ".join(para).strip()
            if text:
                blocks.append(Block(f"<p>{md_inline(text)}</p>"))
            para = []

    while i < len(lines):
        line = lines[i]

        m = re.match(r"^(#{1,4})\s+(.*)$", line)
        if m:
            flush_para()
            level = len(m.group(1))
            title = m.group(2).strip()
            slug = slugify(title)
            if level == 1:
                i += 1
                continue  # page title comes from the template
            tag = f"h{min(level, 4)}"
            # h3 inside Part 1 is a question; give it a checkbox.
            checkbox = ""
            if level == 3:
                checkbox = (f'<input type="checkbox" class="done" '
                            f'data-key="{html.escape(slug)}" '
                            f'aria-label="mark reviewed">')
            blocks.append(Block(
                f'<{tag} id="{slug}">{checkbox}'
                f'<span>{md_inline(title)}</span></{tag}>',
                level, title, slug))
            i += 1
            continue

        if line.strip() == "---":
            flush_para()
            blocks.append(Block('<hr>'))
            i += 1
            continue

        # Fenced code. The course leans on C++ snippets, so these have to
        # survive verbatim — no inline markdown applied inside.
        if line.lstrip().startswith("```"):
            flush_para()
            i += 1
            code = []
            while i < len(lines) and not lines[i].lstrip().startswith("```"):
                code.append(lines[i])
                i += 1
            i += 1
            blocks.append(Block(
                f'<pre class="code">{html.escape(chr(10).join(code))}</pre>'))
            continue

        # Table: a header row, a separator, then body rows.
        if line.lstrip().startswith("|") and i + 1 < len(lines) \
                and re.match(r"^\s*\|[\s:|-]+\|\s*$", lines[i + 1]):
            flush_para()
            head = [c.strip() for c in line.strip().strip("|").split("|")]
            i += 2
            body = []
            while i < len(lines) and lines[i].lstrip().startswith("|"):
                body.append([c.strip() for c
                             in lines[i].strip().strip("|").split("|")])
                i += 1
            th = "".join(f"<th>{md_inline(c)}</th>" for c in head)
            trs = "".join(
                "<tr>" + "".join(f"<td>{md_inline(c)}</td>" for c in row)
                + "</tr>" for row in body)
            blocks.append(Block(
                f'<div class="tw"><table><thead><tr>{th}</tr></thead>'
                f'<tbody>{trs}</tbody></table></div>'))
            continue

        if re.match(r"^\s*[-*]\s+", line):
            flush_para()
            items = []
            while i < len(lines) and re.match(r"^\s*[-*]\s+", lines[i]):
                item = re.sub(r"^\s*[-*]\s+", "", lines[i])
                i += 1
                # Fold continuation lines into the item.
                while i < len(lines) and lines[i].startswith("  ") \
                        and not re.match(r"^\s*[-*]\s+", lines[i]):
                    item += " " + lines[i].strip()
                    i += 1
                items.append(f"<li>{md_inline(item)}</li>")
            blocks.append(Block("<ul>" + "".join(items) + "</ul>"))
            continue

        if line.strip() == "":
            flush_para()
            i += 1
            continue

        para.append(line.strip())
        i += 1

    flush_para()
    return blocks


def build_nav(blocks: list[Block]) -> str:
    out = []
    for b in blocks:
        if b.level == 2:
            out.append(f'<a class="n2" href="#{b.slug}">{md_inline(b.title)}</a>')
        elif b.level == 3:
            # Strip the "Q1. " prefix for the nav; the badge carries it.
            m = re.match(r"^(Q\d+)\.\s*(.*)$", b.title)
            if m:
                out.append(f'<a class="n3" href="#{m.group(1).lower()}-x">'
                           f'<b>{m.group(1)}</b> {md_inline(m.group(2))}</a>'
                           .replace(f'#{m.group(1).lower()}-x', f'#{b.slug}'))
            else:
                out.append(f'<a class="n3" href="#{b.slug}">'
                           f'{md_inline(b.title)}</a>')
    return "\n".join(out)


def plan_html() -> str:
    kinds = {"deep": ("Deep dive", "slate"), "cpp": ("C++", "teal"),
             "talk": ("Talk", "orange")}
    days = []
    for day, items in PLAN:
        rows = []
        for label, mins, kind in items:
            name, color = kinds[kind]
            key = slugify(day + "-" + label)
            rows.append(
                f'<li><input type="checkbox" class="done" data-key="{key}">'
                f'<span class="tag t-{color}">{name}</span>'
                f'<span class="ptext">{md_inline(label)}</span>'
                f'<span class="mins">{mins}</span></li>')
        total = sum(int(m.rstrip("m")) for _, m, _ in items)
        days.append(
            f'<div class="day"><h3>{html.escape(day)}'
            f'<span class="tot">{total // 60}h {total % 60:02d}m</span></h3>'
            f'<ul class="plan">{"".join(rows)}</ul></div>')
    return "".join(days)


def drills_html() -> str:
    rows = []
    for kind, name, target, why in DRILLS:
        badge = "t-teal" if kind == "write" else "t-orange"
        rows.append(
            f'<li><input type="checkbox" class="done" data-key="drill-{name}">'
            f'<span class="tag {badge}">{kind}</span>'
            f'<code class="dname">{name}</code>'
            f'<span class="ptext"><b>{html.escape(target)}</b> — '
            f'{md_inline(why)}</span></li>')
    return (f'<ul class="plan drills">{"".join(rows)}</ul>')


def risks_html() -> str:
    out = []
    for title, body, color in RISKS:
        out.append(f'<div class="risk r-{color}"><b>{md_inline(title)}</b>'
                   f'<span>{md_inline(body)}</span></div>')
    return "".join(out)


def cues_html() -> str:
    """Pull the cue blocks straight from the presentation script."""
    if not SCRIPT.exists():
        return "<p class='muted'>presentation-script.md not found.</p>"
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from cues import parse, strip_md  # noqa: E402

    out = []
    for heading, cues in parse(SCRIPT.read_text()):
        items = "".join(f"<li>{html.escape(strip_md(c))}</li>" for c in cues)
        out.append(f'<div class="cueblk"><h4>{html.escape(strip_md(heading))}'
                   f'</h4><ul>{items}</ul></div>')
    return "".join(out)


def test_status() -> str:
    """Run the firmware suite so the page shows a real number, not a claim."""
    try:
        r = subprocess.run(["make", "test"], cwd=ROOT / "firmware/test",
                           capture_output=True, text=True, timeout=120)
        m = re.findall(r"(\d+)/(\d+) passed", r.stdout)
        if m:
            passed = sum(int(a) for a, _ in m)
            total = sum(int(b) for _, b in m)
            ok = passed == total
            cls = "ok" if ok else "bad"
            return (f'<span class="pill {cls}">{passed}/{total} '
                    f'firmware tests passing</span>')
    except Exception:
        pass
    return '<span class="pill warn">test status unknown</span>'


TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vertex — Onsite Prep</title>
<style>
:root{{
{vars}
  --bg:#fff; --card:#fff; --shadow:0 1px 2px rgba(0,0,0,.06);
}}
@media (prefers-color-scheme:dark){{
  :root{{ --bg:#0f1214; --card:#161a1d; --ink:#f2f2f2; --text2:#9aa0a6;
    --text3:#6b7177; --border:#2a2f34; --shadow:none; }}
}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--bg);color:var(--ink);
  font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;}}
code{{font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;
  background:color-mix(in srgb,var(--border) 55%,transparent);
  padding:.1em .35em;border-radius:4px}}
.wrap{{display:grid;grid-template-columns:260px minmax(0,1fr);
  max-width:1180px;margin:0 auto;gap:0 36px}}
nav{{position:sticky;top:0;align-self:start;height:100vh;overflow-y:auto;
  padding:26px 0 40px;border-right:1px solid var(--border)}}
nav .brand{{font-weight:700;font-size:17px;padding:0 16px 4px}}
nav .sub{{color:var(--text2);font-size:12px;padding:0 16px 16px}}
nav a{{display:block;padding:5px 16px;color:var(--text2);text-decoration:none;
  font-size:13px;border-left:2px solid transparent}}
nav a:hover{{color:var(--ink);background:color-mix(in srgb,var(--border) 30%,transparent)}}
nav a.n2{{font-weight:650;color:var(--ink);margin-top:12px;font-size:13.5px}}
nav a.n3{{padding-left:22px}}
nav a.n3 b{{color:var(--slate);font-weight:650}}
@media (prefers-color-scheme:dark){{nav a.n3 b{{color:var(--teal)}}}}
nav a.active{{border-left-color:var(--red);color:var(--ink);
  background:color-mix(in srgb,var(--red) 8%,transparent)}}
main{{padding:26px 8px 120px;min-width:0}}
h1{{font-size:27px;margin:.2em 0 .1em;letter-spacing:-.02em}}
h2{{font-size:20px;margin:2.2em 0 .5em;padding-top:.5em;letter-spacing:-.01em;
  border-top:1px solid var(--border)}}
h3{{font-size:16.5px;margin:1.7em 0 .4em;display:flex;gap:9px;
  align-items:flex-start;letter-spacing:-.01em}}
h4{{font-size:14px;margin:1.3em 0 .3em;color:var(--text2);
  text-transform:uppercase;letter-spacing:.05em}}
p{{margin:.6em 0}}
ul{{margin:.5em 0;padding-left:1.25em}} li{{margin:.25em 0}}
hr{{border:0;border-top:1px solid var(--border);margin:2.2em 0}}
strong{{font-weight:650}}
.tw{{overflow-x:auto;margin:1em 0}}
table{{border-collapse:collapse;width:100%;font-size:13.5px}}
th,td{{text-align:left;padding:7px 12px;border-bottom:1px solid var(--border);
  vertical-align:top}}
th{{font-weight:650;font-size:12px;text-transform:uppercase;
  letter-spacing:.04em;color:var(--text2)}}
tbody tr:nth-child(odd){{background:color-mix(in srgb,var(--border) 22%,transparent)}}
input.done{{appearance:none;width:17px;height:17px;flex:0 0 17px;margin-top:4px;
  border:1.5px solid var(--text3);border-radius:4px;cursor:pointer;
  transition:.12s}}
input.done:checked{{background:var(--success);border-color:var(--success)}}
input.done:checked::after{{content:"";display:block;width:4px;height:8px;
  margin:1.5px auto;border:solid #fff;border-width:0 2px 2px 0;
  transform:rotate(42deg)}}
h3:has(input.done:checked) span{{color:var(--text3);text-decoration:line-through;
  text-decoration-thickness:1px}}
.hero{{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:.8em 0 0}}
.pill{{font-size:12px;font-weight:600;padding:3px 10px;border-radius:20px;
  border:1px solid var(--border);color:var(--text2)}}
.pill.ok{{color:var(--success);border-color:color-mix(in srgb,var(--success) 40%,transparent);
  background:color-mix(in srgb,var(--success) 9%,transparent)}}
.pill.bad{{color:var(--red);border-color:var(--red)}}
.pill.warn{{color:var(--warning);border-color:var(--warning)}}
.grid2{{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));
  gap:16px;margin:1em 0}}
.day{{background:var(--card);border:1px solid var(--border);border-radius:10px;
  padding:14px 16px;box-shadow:var(--shadow)}}
.day h3{{margin:0 0 .5em;font-size:14.5px;justify-content:space-between;
  border:0;padding:0}}
.tot{{font-size:12px;color:var(--text2);font-weight:500}}
ul.plan{{list-style:none;padding:0;margin:0}}
ul.plan li{{display:flex;gap:9px;align-items:flex-start;padding:6px 0;
  border-top:1px solid var(--border);font-size:13.5px}}
ul.plan li:first-child{{border-top:0}}
ul.plan li:has(input:checked) .ptext{{color:var(--text3);
  text-decoration:line-through}}
.ptext{{flex:1}}
.mins{{color:var(--text3);font-size:12px;font-variant-numeric:tabular-nums}}
.tag{{font-size:10.5px;font-weight:700;text-transform:uppercase;
  letter-spacing:.04em;padding:2px 6px;border-radius:4px;margin-top:2px;
  white-space:nowrap}}
.t-slate{{background:color-mix(in srgb,var(--slate) 15%,transparent);color:var(--slate)}}
.t-teal{{background:color-mix(in srgb,var(--teal) 16%,transparent);color:var(--teal)}}
.t-orange{{background:color-mix(in srgb,var(--orange) 22%,transparent);
  color:color-mix(in srgb,var(--orange) 75%,#000)}}
@media (prefers-color-scheme:dark){{
  .t-slate{{color:#8fb4c4}} .t-orange{{color:var(--orange)}}
}}
.risk{{background:var(--card);border:1px solid var(--border);
  border-left:3px solid var(--text3);border-radius:8px;padding:11px 14px;
  margin:9px 0;font-size:13.5px}}
.risk b{{display:block;margin-bottom:2px}}
.risk span{{color:var(--text2)}}
.r-warning{{border-left-color:var(--warning)}}
.r-red{{border-left-color:var(--red)}}
pre.code,pre.cmd{{background:var(--card);border:1px solid var(--border);
  border-left:3px solid var(--slate);border-radius:7px;padding:11px 14px;
  overflow-x:auto;font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;
  margin:1em 0}}
pre.cmd{{border-left-color:var(--teal)}}
pre.cmd .c{{color:var(--text3)}}
@media (prefers-color-scheme:dark){{
  pre.code,pre.cmd{{background:#0b0e10;border-color:var(--border)}}
}}
ul.drills li{{align-items:center}}
.dname{{font-size:12px;min-width:62px}}
.cueblk{{break-inside:avoid;margin:0 0 14px}}
.cueblk h4{{margin:0 0 .2em;color:var(--slate);text-transform:none;
  font-size:13px;letter-spacing:0}}
@media (prefers-color-scheme:dark){{.cueblk h4{{color:var(--teal)}}}}
.cueblk ul{{margin:0;font-size:13px;color:var(--text2)}}
.cuewrap{{columns:2;column-gap:28px}}
.muted{{color:var(--text2)}}
.bar{{position:fixed;right:18px;bottom:18px;background:var(--card);
  border:1px solid var(--border);border-radius:24px;padding:7px 15px;
  font-size:12.5px;box-shadow:0 2px 10px rgba(0,0,0,.12);display:flex;
  gap:11px;align-items:center;z-index:9}}
.bar button{{font:inherit;font-size:12px;background:none;border:0;
  color:var(--text2);cursor:pointer;text-decoration:underline;padding:0}}
.bar button:hover{{color:var(--red)}}
@media (max-width:860px){{
  .wrap{{grid-template-columns:1fr}}
  nav{{position:static;height:auto;border-right:0;
    border-bottom:1px solid var(--border)}}
  .cuewrap{{columns:1}}
}}
@media print{{
  nav,.bar{{display:none}} .wrap{{display:block}} body{{font-size:11pt}}
}}
</style>
</head>
<body>
<div class="wrap">
<nav>
  <div class="brand">Vertex — Onsite Prep</div>
  <div class="sub">{date} · onsite in 2 days</div>
  <a class="n2" href="#plan">Two-day plan</a>
  <a class="n2" href="#risks">Volunteer these first</a>
  <a class="n2" href="#drills">C++ drills</a>
{nav}
  <a class="n2" href="#cues">Presenter cues</a>
</nav>
<main>
  <h1>Firmware prep sheet</h1>
  <div class="hero">
    <span class="pill">SWE II · pragmatic 1:1s</span>
    {tests}
    <span class="pill">{qcount} written answers</span>
  </div>

  <h2 id="plan">Two-day plan</h2>
  <div class="grid2">{plan}</div>

  <h2 id="risks">Volunteer these first</h2>
  <p class="muted">Each of these is a real gap. Naming it yourself reads as
  judgment; being caught on it reads as a blind spot.</p>
  {risks}

  <h2 id="drills">C++ drills</h2>
  <p class="muted">Against the real firmware, verified by the real tests.
  <b>write</b> removes a function body and leaves a comment describing what it
  must do — you write the C++. <b>fix</b> injects a one-line defect — you read
  the failure and find it.</p>
  <pre class="cmd">cd firmware/test/drills
python3 drill.py list
python3 drill.py start write-1
python3 drill.py check
python3 drill.py answer     <span class="c"># after you have tried</span>
python3 drill.py reset</pre>
  {drills}
  <p class="muted">Originals are snapshotted before the first drill, so
  <code>reset</code> always restores a clean tree. Baseline is 91/91.</p>

{body}

  <h2 id="cues">Presenter cues</h2>
  <p class="muted">Generated from <code>presentation-script.md</code>. The
  script is the source of truth for wording.</p>
  <div class="cuewrap">{cues}</div>
</main>
</div>
<div class="bar">
  <span id="prog">0 / 0</span>
  <button onclick="if(confirm('Clear all checkboxes?')){{localStorage.clear();location.reload()}}">reset</button>
  <button onclick="window.print()">print</button>
</div>
<script>
const boxes=[...document.querySelectorAll('input.done')];
const prog=document.getElementById('prog');
function sync(){{
  prog.textContent=boxes.filter(b=>b.checked).length+' / '+boxes.length;
}}
boxes.forEach(b=>{{
  const k='vtx:'+b.dataset.key;
  b.checked=localStorage.getItem(k)==='1';
  b.addEventListener('change',()=>{{
    localStorage.setItem(k,b.checked?'1':'0'); sync();
  }});
}});
sync();
// Highlight the nav entry for whatever is on screen.
const links=new Map([...document.querySelectorAll('nav a')]
  .map(a=>[a.getAttribute('href').slice(1),a]));
const seen=new Set();
new IntersectionObserver(es=>{{
  es.forEach(e=>e.isIntersecting?seen.add(e.target.id):seen.delete(e.target.id));
  links.forEach(a=>a.classList.remove('active'));
  const first=[...document.querySelectorAll('h2[id],h3[id]')]
    .find(h=>seen.has(h.id));
  if(first&&links.has(first.id)) links.get(first.id).classList.add('active');
}},{{rootMargin:'-70px 0px -70% 0px'}})
  .observe&&document.querySelectorAll('h2[id],h3[id]').forEach(h=>{{
    new IntersectionObserver(es=>{{
      es.forEach(e=>e.isIntersecting?seen.add(e.target.id):seen.delete(e.target.id));
      links.forEach(a=>a.classList.remove('active'));
      const f=[...document.querySelectorAll('h2[id],h3[id]')]
        .find(x=>seen.has(x.id));
      if(f&&links.has(f.id)) links.get(f.id).classList.add('active');
    }},{{rootMargin:'-70px 0px -70% 0px'}}).observe(h);
  }});
</script>
</body>
</html>
"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--open", action="store_true", help="open when done")
    args = ap.parse_args()

    if not SRC.exists():
        sys.exit(f"not found: {SRC}")

    blocks = render(SRC.read_text())
    body = "\n".join(b.html for b in blocks)
    qcount = sum(1 for b in blocks if re.match(r"^Q\d+\.", b.title))

    from datetime import date
    page = TEMPLATE.format(
        vars="\n".join(f"  --{k}:{v};" for k, v in CSS_VARS.items()),
        date=date.today().strftime("%b %-d"),
        nav=build_nav(blocks),
        body=body,
        plan=plan_html(),
        risks=risks_html(),
        cues=cues_html(),
        drills=drills_html(),
        tests=test_status(),
        qcount=qcount,
    )
    OUT.write_text(page)
    kb = len(page) / 1024
    print(f"\n  wrote {OUT.relative_to(ROOT)} — {kb:.0f} KB, "
          f"{qcount} answers, {len(blocks)} blocks\n")

    if args.open:
        subprocess.run(["open", str(OUT)])


if __name__ == "__main__":
    main()

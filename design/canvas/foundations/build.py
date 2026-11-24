"""Generates Foundations-Tokens from DESIGN.md's frontmatter: python3 design/canvas/foundations/build.py"""
import html
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
from boards import CHROME_CSS, md_inline, page, place_board, write_board  # noqa: E402

DESIGN = os.path.join(HERE, "..", "..", "..", "DESIGN.md")
W, PAD = 1440, 48
SANS = '-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif'

CSS = """
.ftk{width:1344px;display:flex;flex-direction:column;gap:40px}
.ftk h2{margin:0 0 12px;font-size:16px;line-height:22px;font-weight:600}
.ftk p{margin:0 0 12px;color:#5c5c61}
.ftk .theme{display:flex;gap:24px}
.ftk .pane{flex:1;border-radius:12px;padding:16px;box-shadow:inset 0 0 0 1px rgba(127,127,127,.28)}
.ftk .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px 10px}
.ftk .sw{height:36px;border-radius:8px;box-shadow:inset 0 0 0 1px rgba(127,127,127,.28)}
.ftk .n{display:block;margin-top:4px;font-weight:500}
.ftk .v{display:block;font:11.5px/15px ui-monospace,SF Mono,Menlo,monospace;opacity:.72}
.ftk .row{display:flex;gap:20px;align-items:flex-end;flex-wrap:wrap}
.ftk .scale{display:grid;grid-template-columns:120px 250px 1fr;gap:8px 20px;align-items:baseline}
.ftk .scroll{position:relative;width:150px;height:110px;border-radius:8px;box-shadow:inset 0 0 0 1px rgba(127,127,127,.28)}
.ftk .thumb{position:absolute;top:2px;right:2px;height:48px}
.ftk .ctl{display:inline-flex;align-items:center;height:32px;padding:0 12px;border-radius:8px;font-weight:500}
"""


def frontmatter():
    """The two levels DESIGN.md's token groups use: scalars, and one nested map per type style."""
    text = open(DESIGN).read().split("---\n")[1]
    out, group, item = {}, None, None
    for line in text.splitlines():
        m = re.match(r'^( *)([\w-]+):(?: "?((?:[^"\\]|\\.)*)"?)?$', line)
        if not m:
            continue
        indent, key, value = len(m.group(1)), m.group(2), (m.group(3) or "").replace('\\"', '"')
        if indent == 0:
            group = out[key] = value or {}
        elif indent == 2 and isinstance(group, dict):
            item = group[key] = value or {}
        elif indent == 4 and isinstance(item, dict):
            item[key] = value
    return out


def colour(name, value):
    return (
        f'<div><div class="sw" style="background:{html.escape(value)}"></div>'
        f'<span class="n">{name}</span><span class="v">{html.escape(value)}</span></div>'
    )


def colours(tokens):
    light = {k: v for k, v in tokens.items() if not k.endswith("-dark")}
    dark = {k: tokens.get(k + "-dark", v) for k, v in light.items()}

    def pane(values, bg, ink, label):
        swatches = "".join(colour(k, v) for k, v in values.items())
        return f'<div class="pane" style="background:{bg};color:{ink}"><h2>{label}</h2><div class="grid">{swatches}</div></div>'

    return (
        "<section><h2>Colours</h2>"
        "<p>A token with no dark value of its own keeps the light one.</p>"
        f'<div class="theme">{pane(light, light["sheet"], light["ink"], "Light")}{pane(dark, dark["sheet"], dark["ink"], "Dark")}</div></section>'
    )


def typography(tokens):
    rows = []
    for name, t in tokens.items():
        lh = t["lineHeight"]
        family = html.escape(t["fontFamily"], quote=True)
        rows.append(
            f'<span class="n">{name}</span>'
            f'<span class="v">{t["fontSize"]} / {lh} · {t["fontWeight"]}</span>'
            f'<span style="font-family:{family};font-size:{t["fontSize"]};font-weight:{t["fontWeight"]};line-height:{lh}">'
            "The quiet workbench keeps 4 agents in view</span>"
        )
    return f'<section><h2>Type scale</h2><div class="scale">{"".join(rows)}</div></section>'


def boxes(title, tokens, draw):
    cells = "".join(f'<div>{draw(v)}<span class="n">{k}</span><span class="v">{v}</span></div>' for k, v in tokens.items())
    return f'<section><h2>{title}</h2><div class="row">{cells}</div></section>'


def radius(value):
    return f'<div style="width:72px;height:72px;border:1px solid #a1a1a6;background:#fff;border-radius:{value}"></div>'


def space(value):
    return f'<div style="width:{value};height:40px;background:#0b6fdc;border-radius:1px"></div>'


def scrollbar_spec(c):
    def area(bg, ink, width, alpha, label):
        return (
            f'<div><div class="scroll" style="background:{bg}"><div class="thumb" style="width:{width}px;'
            f'border-radius:{width // 2}px;background:color-mix(in srgb,{ink} {alpha}%,transparent)"></div></div>'
            f'<span class="n">{label}</span><span class="v">{width} px, ink {alpha} %</span></div>'
        )

    ink, dark = c["ink"], c["ink-dark"]
    return (
        "<section><h2>Scrollbars (S3)</h2>"
        "<p>Overlay thumbs only: no track, no gutter. Inset 2 px, at least 24 px long. The thumb fades in while the "
        "area scrolls or is hovered, widens under the pointer, can be dragged, and fades out about a second later.</p>"
        f'<div class="row">{area(c["sheet"], ink, 6, 26, "Light, at rest")}{area(c["sheet"], ink, 8, 42, "Light, under the pointer")}'
        f'{area(c["sheet-dark"], dark, 6, 26, "Dark, at rest")}{area(c["sheet-dark"], dark, 8, 42, "Dark, under the pointer")}</div></section>'
    )


def focus_spec(c):
    def set_(bg, hair, ink, focus, label):
        base = f"background:{bg};color:{ink};box-shadow:inset 0 0 0 1px {hair}"
        return (
            f'<div style="background:{bg};padding:16px;border-radius:12px;display:flex;gap:20px;box-shadow:inset 0 0 0 1px rgba(127,127,127,.28)">'
            f'<span class="ctl" style="{base};outline:2px solid {focus};outline-offset:2px">Control</span>'
            f'<span class="ctl" style="{base};outline:2px solid {focus};outline-offset:-2px;width:180px;font-weight:400">Field</span>'
            f'<span class="v" style="color:{ink};align-self:center">{label} {focus}</span></div>'
        )

    return (
        "<section><h2>Focus (C3)</h2>"
        "<p>One solid 2 px line in focus blue, no translucent halo. 2 px off a control (<b>focus-line</b>); on the edge "
        "of a field, a full-width row or the composer card (<b>focus-line-inset</b>). At least 3:1 on the ground, the "
        "card and the hairline.</p>"
        f'<div class="row">{set_(c["sheet"], c["hair"], c["ink"], c["focus"], "Light")}'
        f'{set_(c["sheet-dark"], c["hair-dark"], c["ink-dark"], c["focus-dark"], "Dark")}</div></section>'
    )


def estimate_height(tokens):
    """Section heights add up from fixed line heights, so the board needs no browser to measure it."""
    light = [k for k in tokens["colors"] if not k.endswith("-dark")]
    swatch_rows = -(-len(light) // 4)
    sizes = [
        22 + 12 + 30 + 32 + 34 + swatch_rows * (36 + 4 + 18 + 15) + (swatch_rows - 1) * 12,
        34 + len(tokens["typography"]) * 30,
        34 + 72 + 37,
        34 + 40 + 37,
        34 + 30 + 110 + 37,
        34 + 30 + 64,
    ]
    return 112 + sum(sizes) + 40 * (len(sizes) - 1) + PAD + 24


def main():
    t = frontmatter()
    c = t["colors"]
    h = estimate_height(t)
    title = "Foundations — tokens"
    body = (
        f'<div class="dcb-board" style="width:{W}px;height:{h}px">'
        f'<div class="dcb-title">{title}</div>'
        f'<div class="dcb-subtitle">{md_inline("Generated from the frontmatter of `DESIGN.md`. Rebuild with `python3 design/canvas/foundations/build.py`.")}</div>'
        f'<div class="ftk" style="position:absolute;left:{PAD}px;top:112px">'
        + colours(c)
        + typography(t["typography"])
        + boxes("Radius", t["rounded"], radius)
        + boxes("Spacing", t["spacing"], space)
        + scrollbar_spec(c)
        + focus_spec(c)
        + "</div></div>"
    )
    write_board("Foundations-Tokens", page(title, CHROME_CSS + CSS, body, W, h, themed=False))
    place_board("Foundations-Tokens", title, W, h, "foundations")
    print(f"Foundations-Tokens {W}x{h}")


main()

"""Writes the boards of one captured area: python3 build.py <area> (after capture.spec.mts)."""
import glob
import html
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
from boards import CHROME_CSS, caption_lines, escape_holes, md_inline, page, place_board, write_board  # noqa: E402

REPO = os.path.join(HERE, "..", "..", "..")
DIST = os.path.join(REPO, "packages", "ui", "dist", "assets")
PAD, GAP, ROW_GAP, HEAD = 48, 48, 44, 112

# One captured window. It stands in for <html> and <body>: the app's root tokens, font and viewport units
# land on it, and its transform makes it the containing block of everything position: fixed.
FRAME_CSS = """
.dcb-crop{position:absolute;overflow:hidden;border-radius:10px;box-shadow:0 0 0 1px rgba(0,0,0,.12),0 6px 24px rgba(0,0,0,.08)}
.dcb-crop[data-bare]{border-radius:0;box-shadow:none}
.dcb-frame{position:absolute;overflow:hidden;transform:translateZ(0)}
.dcb-frame *,.dcb-frame *::before,.dcb-frame *::after{animation:none!important;transition:none!important;caret-color:transparent}
"""


def frame_css(css):
    """Moves the app's page-level rules onto .dcb-frame and lets a frozen frame keep its hover and focus."""
    css = css.replace(":root:not(.dark)", ".dcb-frame:not(.dark)")
    css = re.sub(r"(?<![\w-]):root\b", ".dcb-frame", css)
    css = re.sub(r"(?<=[{},])\s*(?:html|body)(?=[,{])", ".dcb-frame", css)
    css = re.sub(r"\b100(?:d|s|l)?vh\b", "var(--dcb-vh)", css)
    css = re.sub(r"\b100(?:d|s|l)?vw\b", "var(--dcb-vw)", css)
    # Not the media feature: Tailwind puts every hover rule under `@media (hover:hover)`.
    css = re.sub(r"(?<!\\)(?<!\(hover):hover\b", ":is(:hover,[data-dcb-hover])", css)
    css = re.sub(r"(?<!\\):focus-visible\b", ":is(:focus-visible,[data-dcb-focus-visible])", css)
    css = re.sub(r"(?<!\\):focus-within\b", ":is(:focus-within,[data-dcb-focus-within])", css)
    css = re.sub(r"(?<!\\):focus(?![\w-])", ":is(:focus,[data-dcb-focus])", css)
    return css.replace("{{", "{ {")


def app_css(runtime):
    built = [open(f).read() for f in sorted(glob.glob(os.path.join(DIST, "*.css")))]
    if not built:
        sys.exit(f"no built CSS in {DIST}")
    return "\n".join(frame_css(sheet) for sheet in [*built, *runtime])


def viewport_units(markup):
    """Inline styles may size to the window too."""
    markup = re.sub(r"\b100(?:d|s|l)?vh\b", "var(--dcb-vh)", markup)
    return re.sub(r"\b100(?:d|s|l)?vw\b", "var(--dcb-vw)", markup)


def frame(f, x, y, bare):
    cx, cy, cw, ch = f["crop"]
    vw, vh = f["viewport"]["width"], f["viewport"]["height"]
    theme = f["theme"] or "{{mode}}"
    return (
        f'<div class="dcb-crop"{" data-bare" if bare else ""} data-state="{f["id"]}" '
        f'style="left:{x}px;top:{y}px;width:{cw}px;height:{ch}px">'
        f'<div class="dcb-frame {theme}" style="--dcb-vw:{vw}px;--dcb-vh:{vh}px;left:{-cx}px;top:{-cy}px;'
        f'width:{vw}px;height:{vh}px">{escape_holes(viewport_units(f["html"]))}</div></div>'
    )


def cell_width(f):
    return max(f["crop"][2], 220)


def rows(frames, width):
    """Frames in reading order, wrapped like text at the board's width."""
    out, used = [], 0
    for f in frames:
        w = cell_width(f)
        if not out or used + w > width - PAD:
            out.append([])
            used = PAD
        out[-1].append(f)
        used += w + GAP
    return out


def layout(board, frames):
    if board.get("bare"):
        if len(frames) != 1:
            sys.exit(f'{board["file"]}: a bare board holds exactly one state')
        _, _, w, h = frames[0]["crop"]
        return frame(frames[0], 0, 0, True), w, h
    parts = [f'<div class="dcb-title">{html.escape(board["title"])}</div>']
    if board.get("subtitle"):
        parts.append(f'<div class="dcb-subtitle">{md_inline(board["subtitle"])}</div>')
    y, right = HEAD, 900
    for row in rows(frames, board["width"]):
        cells = [cell_width(f) for f in row]
        cap_h = max(caption_lines(f["caption"], w) for f, w in zip(row, cells)) * 18 + 10
        x = PAD
        for f, w in zip(row, cells):
            parts.append(
                f'<div class="dcb-caption" style="left:{x}px;top:{y}px;width:{w}px">{md_inline(f["caption"])}</div>'
            )
            parts.append(frame(f, x, y + cap_h, False))
            x += w + GAP
        right = max(right, x - GAP + PAD)
        y += cap_h + max(f["crop"][3] for f in row) + ROW_GAP
    return "\n".join(parts), right, y - ROW_GAP + PAD


def main():
    area = sys.argv[1]
    data = json.load(open(os.path.join(HERE, ".work", area + ".json")))
    areas = json.load(open(os.path.join(REPO, "design", "areas.json")))["areas"]
    page_id = next(a["page"] for a in areas if a["id"] == area)
    css = app_css(data["runtimeCss"]) + FRAME_CSS + CHROME_CSS
    for board in data["boards"]:
        frames = [f for f in data["frames"] if f["board"] == board["file"]]
        body, w, h = layout(board, frames)
        body = f'<div class="dcb-board" data-mode="{{{{mode}}}}" style="width:{w}px;height:{h}px">\n{body}\n</div>'
        text = page(board["title"], css, body, w, h)
        write_board(board["file"], text)
        place_board(board["file"], board["title"], w, h, page_id)
        print(f'{board["file"]}: {len(frames)} state(s), {w}x{h}, {len(text) / 1e6:.2f} MB')


main()

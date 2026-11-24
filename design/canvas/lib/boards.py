"""What the product-board builders share: the page shape, captions and writing canvas.json."""
import html
import json
import math
import os
import re

CANVAS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT = os.path.join(CANVAS, "project")
INDEX = os.path.join(PROJECT, "canvas.json")
ZWSP = "​"

UI = '-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif'
MONO = "ui-monospace,SF Mono,Menlo,monospace"

# Board chrome. Every class starts with dcb-, so it can never meet an app class.
CHROME_CSS = f"""
.dcb-board{{position:relative;background:#f3f3f5;color:#1f1f1f;font:13px/18px {UI}}}
.dcb-title{{position:absolute;left:48px;top:36px;font:600 22px/28px {UI};letter-spacing:-.01em}}
.dcb-subtitle{{position:absolute;left:48px;top:68px;color:#5c5c61}}
.dcb-caption{{position:absolute;font:12.5px/18px {UI};color:#3a3a3c}}
.dcb-caption b{{color:#1f1f1f;font-weight:600}}
.dcb-caption code,.dcb-subtitle code{{font:12px {MONO};background:rgba(0,0,0,.06);border-radius:4px;padding:0 4px}}
.dcb-board[data-mode=dark]{{background:#101011;color:#ececec}}
.dcb-board[data-mode=dark] .dcb-subtitle,.dcb-board[data-mode=dark] .dcb-caption{{color:#aeaeb4}}
.dcb-board[data-mode=dark] .dcb-caption b{{color:#ececec}}
.dcb-board[data-mode=dark] :is(.dcb-caption,.dcb-subtitle) code{{background:rgba(255,255,255,.09)}}
"""


def escape_holes(text):
    """`{{` opens a template hole in the canvas runtime."""
    return text.replace("{{", "{" + ZWSP + "{")


def md_inline(text):
    text = html.escape(text, quote=False)
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    return escape_holes(text)


def caption_lines(text, width):
    plain = re.sub(r"\*\*|`", "", text)
    return max(1, math.ceil(len(plain) / max(20, width / 6.7))) if plain else 0


def page(title, css, body, width, height, themed=True):
    """A board file. In a themed board `{{mode}}` in the body is the Theme tweak: light or dark."""
    props = {"$preview": {"width": width, "height": height}}
    if themed:
        props = {"mode": {"editor": "enum", "options": ["light", "dark"], "default": "light"}, **props}
    vals = "mode: this.props.mode ?? 'light'" if themed else ""
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{html.escape(title)}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<style>
body{{margin:0}}
{css}
</style>
</helmet>
{body}
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{json.dumps(props, separators=(",", ":"))}'>
class Component extends DCLogic {{
  renderVals() {{ return {{ {vals} }}; }}
}}
</script>
</body>
</html>
"""


def write_board(stem, text):
    with open(os.path.join(PROJECT, stem + ".dc.html"), "w") as f:
        f.write(text)


def place_board(stem, title, width, height, page_id):
    """Updates a board's canvas.json entry in place, or adds it below everything else on its page."""
    with open(INDEX) as f:
        index = json.load(f)
    key = stem + ".dc.html"
    entry = index["boards"].get(key)
    if entry is None:
        mates = [b for b in index["boards"].values() if b["page"] == page_id]
        y = max((b["y"] + b["h"] for b in mates), default=-160) + 160
        entry = index["boards"][key] = {"h": height, "page": page_id, "title": title, "w": width, "x": 0, "y": y}
        last = [i for i, k in enumerate(index["order"]) if index["boards"][k]["page"] == page_id]
        index["order"].insert(last[-1] + 1 if last else len(index["order"]), key)
    entry.update(h=height, title=title, w=width)
    entry.pop("is_interactive", None)
    with open(INDEX, "w") as f:
        json.dump(index, f, indent=2, ensure_ascii=False)
    overlaps = [
        k
        for k, b in index["boards"].items()
        if k != key
        and b["page"] == entry["page"]
        and b["x"] < entry["x"] + width
        and entry["x"] < b["x"] + b["w"]
        and b["y"] < entry["y"] + height
        and entry["y"] < b["y"] + b["h"]
    ]
    if overlaps:
        print(f"warning: {stem} ({width}x{height}) overlaps {', '.join(overlaps)} on the canvas; move one")

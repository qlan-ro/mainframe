"""What the product-board builders share: the page shape, captions and writing canvas.json."""
import base64
import getpass
import html
import json
import math
import os
import re
import socket
import sys
from html.parser import HTMLParser

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


# Names of CI machines, and words of every page.
_COMMON = {"root", "runner", "user", "localhost"}


def name_pattern(name):
    """Finds a name of this machine. One that may be a word (`max`, `main`, `alex`) counts only where it names a user."""
    start = rf"(?<![a-z0-9]){re.escape(name)}"
    word = rf"{start}(?![a-z0-9])"
    if len(name) < 8 and name.isalpha():
        mail = r"[\w.-]+\.(?:com|dev|org|io|net|test|example)\b"
        machine = r"(?:mac|macbook|imac|pc|laptop|computer|desktop)\b"
        word = (
            rf"(?:~{word}|(?<![._-]){word}(?=@(?!{mail})\w)|{start}(?=(?:[’']?s)?[ -]+{machine})"
            rf"|(?<=user[:=]){word}|(?<=user: ){word}|(?<=user=\"){word}|(?<=logname=){word}|(?<=logged in as ){word})"
        )
    return re.compile(f"(?i){word}")


def machine_names():
    """The user and host names of this machine, in every spelling the app could show."""
    host = socket.gethostname()
    return {getpass.getuser(), os.path.basename(os.path.expanduser("~")), host, host.split(".")[0]}


# The shapes of a local path, shared with design/tools/check.mjs, which holds committed boards to the same rule.
with open(os.path.join(CANVAS, "lib", "local-paths.json")) as f:
    _PATHS = json.load(f)
LOCAL_PATH = re.compile(f"(?:{'|'.join(_PATHS['paths'])}){_PATHS['end']}")
ENCODED = re.compile(_PATHS["encoded"])
BASE64 = re.compile(_PATHS["base64"])
WRAP = re.compile(_PATHS["wrap"])


def _decoded(match):
    by_hex, entity_hex, entity, octal, slash, _ = match.groups()
    if by_hex or entity_hex:
        return chr(int(by_hex or entity_hex, 16))
    if entity or octal:
        return chr(int(entity) if entity else int(octal, 8))
    return "/" if slash else "\\"


def _unbase64(run):
    """What a base64 run says. Dropping the NULs reads UTF-16 as well."""
    run = run.replace("-", "+").replace("_", "/")
    run = run[:-1] if len(run) % 4 == 1 else run
    return base64.b64decode(run + "=" * (-len(run) % 4)).decode("latin-1").replace("\0", "")


def local_paths(text):
    """Home and temp paths of a machine, escaped ones (`%2FUsers%2F…`) and base64 ones included."""
    runs = {*BASE64.findall(text), *BASE64.findall(WRAP.sub("", text))}
    texts = [text, *map(_unbase64, runs)]
    return sorted({path for t in texts for path in LOCAL_PATH.findall(ENCODED.sub(_decoded, t))})


class _Markup(HTMLParser):
    """Collects what a board says: its text and attribute values, without CSS and scripts."""

    def __init__(self):
        super().__init__()
        self.parts = []
        self._skipping = False

    def handle_starttag(self, tag, attrs):
        self._skipping = tag in ("style", "script")
        self.parts += [value for name, value in attrs if value and name not in ("class", "style")]

    def handle_endtag(self, tag):
        if tag in ("style", "script"):
            self._skipping = False

    def handle_data(self, data):
        if not self._skipping:
            self.parts.append(data)


def leaks(text, names=None):
    """What in a board tells whose machine drew it: home and temp paths, the user name, the host name."""
    names = machine_names() if names is None else names
    found = local_paths(text)
    markup = _Markup()
    markup.feed(text)
    markup.close()
    for name in sorted(n for n in names if len(n) > 2 and n.lower() not in _COMMON):
        pattern = name_pattern(name)
        for part in markup.parts:
            found += pattern.findall(part)
    return sorted(set(found))


def write_board(stem, text):
    """The only way a board is written, whichever builder drew it, so none can write a leak."""
    found = leaks(text)
    if found:
        sys.exit(f"{stem}: the board names this machine, not written: {', '.join(found[:10])}")
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
        f.write("\n")
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

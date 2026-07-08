#!/usr/bin/env python3
"""Implements the pattern grep for verify-gate.sh (see that file for the rule
this enforces). Kept as a separate module because reliably matching forbidden
patterns needs a token-aware pass, not a bare line grep:

  * a bare word regex flags `unsafe`/`anyhow` inside string literals and comments
    (`"unsafe path detected"`, `warn!("proceeding anyhow")`) — false positives on
    validation/log strings this daemon is guaranteed to contain;
  * counting `{`/`}` per raw line to find the end of a `#[cfg(test)]` module
    miscounts when a brace lives inside a string/char literal (`let s = "{";`),
    leaking or truncating the test-exempt mask.

So we first lex each file into a "masked" copy where every string literal, char
literal, line comment, and block comment is blanked to spaces (newlines kept, so
line indices are preserved). All matching and brace counting then runs on the
masked code, which contains only real tokens.
"""
import re
import sys
from pathlib import Path

ALWAYS_FORBIDDEN = [
    (re.compile(r"\bunsafe\b"), "unsafe"),
    (re.compile(r"\btodo!\("), "todo!("),
    (re.compile(r"\bunimplemented!\("), "unimplemented!("),
    (re.compile(r"\bpanic!\("), "panic!("),
    (re.compile(r"\bstatic\s+mut\b"), "static mut"),
    (re.compile(r"\blazy_static\b"), "lazy_static"),
    (re.compile(r"std::thread::spawn"), "std::thread::spawn"),
    (re.compile(r"\banyhow\b"), "anyhow"),
]

# The crate-level `#![forbid(unsafe_code)]` declaration is the mechanism that
# enforces the unsafe ban; `\bunsafe\b` already won't match `unsafe_code` (the
# trailing `_` is a word char, so there is no boundary), but keep the explicit
# guard so a future rule change can't accidentally trip its own grep.
FORBID_DECLARATION = re.compile(r"#!\[forbid\(unsafe_code\)\]")

UNWRAP_EXPECT = [
    (re.compile(r"\.unwrap\("), ".unwrap("),
    (re.compile(r"\.expect\("), ".expect("),
]

CFG_TEST_ATTR = re.compile(r"#\[cfg\(test\)\]")


def _is_ident_char(ch: str) -> bool:
    return ch.isalnum() or ch == "_"


def mask_code(text: str) -> str:
    """Returns a copy of `text` with string literals, char literals, and
    comments replaced by spaces (newlines preserved), leaving only real code
    tokens. String/char/comment forbidden-word matches and stray braces vanish;
    line count and column positions are unchanged."""
    chars = list(text)
    n = len(chars)

    def blank(a: int, b: int) -> None:
        for k in range(a, min(b, n)):
            if chars[k] != "\n":
                chars[k] = " "

    i = 0
    while i < n:
        c = text[i]
        nxt = text[i + 1] if i + 1 < n else ""

        # Line comment: `//` … EOL.
        if c == "/" and nxt == "/":
            j = i
            while j < n and text[j] != "\n":
                j += 1
            blank(i, j)
            i = j
            continue

        # Block comment: `/* … */`, nestable in Rust.
        if c == "/" and nxt == "*":
            depth = 1
            j = i + 2
            while j < n and depth > 0:
                if text[j] == "/" and j + 1 < n and text[j + 1] == "*":
                    depth += 1
                    j += 2
                    continue
                if text[j] == "*" and j + 1 < n and text[j + 1] == "/":
                    depth -= 1
                    j += 2
                    continue
                j += 1
            blank(i, j)
            i = j
            continue

        prev_is_ident = i > 0 and _is_ident_char(text[i - 1])

        # Raw string: (b)r "…"  |  (b)r#…"…"#…  — only at a token boundary.
        if not prev_is_ident and (c == "r" or (c == "b" and nxt == "r")):
            p = i + 1 if c == "r" else i + 2
            h = 0
            while p + h < n and text[p + h] == "#":
                h += 1
            if p + h < n and text[p + h] == '"':
                terminator = '"' + "#" * h
                end = text.find(terminator, p + h + 1)
                end = n if end == -1 else end + len(terminator)
                blank(i, end)
                i = end
                continue

        # Byte string / byte char: b"…" | b'…' — only at a token boundary.
        if not prev_is_ident and c == "b" and nxt in ('"', "'"):
            end = _scan_quoted(text, i + 1, nxt, n)
            blank(i, end)
            i = end
            continue

        # Normal string literal.
        if c == '"':
            end = _scan_quoted(text, i, '"', n)
            blank(i, end)
            i = end
            continue

        # Char literal vs lifetime/label.
        if c == "'":
            if nxt == "\\":
                # Escaped char literal: skip the escaped char, then to closing `'`.
                j = i + 2
                if j < n:
                    j += 1
                while j < n and text[j] != "'":
                    j += 1
                if j < n:
                    j += 1
                blank(i, j)
                i = j
                continue
            if i + 2 < n and text[i + 2] == "'":
                # Single-char literal `'x'`.
                blank(i, i + 3)
                i = i + 3
                continue
            # Otherwise a lifetime (`'a`, `'static`) or a loop label — not a
            # literal; consume just the quote so following code is scanned.
            i += 1
            continue

        i += 1

    return "".join(chars)


def _scan_quoted(text: str, quote_pos: int, quote: str, n: int) -> int:
    """Returns the index just past a `"…"`/`'…'` literal that opens at
    `quote_pos`, honoring `\\`-escapes."""
    j = quote_pos + 1
    while j < n:
        if text[j] == "\\":
            j += 2
            continue
        if text[j] == quote:
            return j + 1
        j += 1
    return n


def is_main_boot(path: Path) -> bool:
    return path.name == "main.rs" and path.parent.name == "src" and "mainframe-daemon" in path.parts


def is_binary_crate(path: Path) -> bool:
    """The daemon binary crate may use `anyhow` at its top level (PORTING.md §5,
    §8; plan §5). Library crates may not."""
    return "mainframe-daemon" in path.parts


def is_test_dir_file(path: Path) -> bool:
    return "tests" in path.parts


def test_block_line_mask(masked_lines: list[str]) -> list[bool]:
    """Returns, per line, whether that line is inside a #[cfg(test)] block (the
    attribute line through the matching close-brace of the following `mod … { }`).
    Runs on masked lines so braces inside strings/comments do not miscount."""
    mask = [False] * len(masked_lines)
    i = 0
    while i < len(masked_lines):
        if CFG_TEST_ATTR.search(masked_lines[i]):
            start = i
            depth = 0
            opened = False
            j = i
            while j < len(masked_lines):
                depth += masked_lines[j].count("{")
                depth -= masked_lines[j].count("}")
                if "{" in masked_lines[j]:
                    opened = True
                if opened and depth <= 0:
                    break
                j += 1
            end = min(j, len(masked_lines) - 1)
            for k in range(start, end + 1):
                mask[k] = True
            i = end + 1
        else:
            i += 1
    return mask


def scan_file(path: Path) -> list[str]:
    violations = []
    text = path.read_text(encoding="utf-8")
    raw_lines = text.splitlines()
    masked_lines = mask_code(text).splitlines()
    mask = test_block_line_mask(masked_lines)
    file_is_test_exempt = is_test_dir_file(path) or is_main_boot(path)
    anyhow_exempt = is_binary_crate(path)

    for idx, code in enumerate(masked_lines):
        source = raw_lines[idx].strip()

        for pattern, label in ALWAYS_FORBIDDEN:
            if label == "anyhow" and anyhow_exempt:
                continue
            if pattern.search(code) and not FORBID_DECLARATION.search(code):
                violations.append(f"{path}:{idx + 1}: forbidden pattern `{label}`: {source}")

        for pattern, label in UNWRAP_EXPECT:
            if pattern.search(code):
                exempt = file_is_test_exempt or mask[idx]
                if not exempt:
                    violations.append(f"{path}:{idx + 1}: forbidden pattern `{label}`: {source}")

    return violations


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: verify_gate.py <crates_dir>", file=sys.stderr)
        return 2

    crates_dir = Path(sys.argv[1])
    if not crates_dir.is_dir():
        print(f"crates dir not found: {crates_dir}", file=sys.stderr)
        return 2

    all_violations: list[str] = []
    for path in sorted(crates_dir.rglob("*.rs")):
        all_violations.extend(scan_file(path))

    if all_violations:
        print(f"verify-gate: {len(all_violations)} forbidden-pattern violation(s):\n")
        for v in all_violations:
            print(f"  {v}")
        return 1

    print("verify-gate: no forbidden patterns found.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

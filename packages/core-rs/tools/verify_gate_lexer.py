"""Rust literal and comment masking used by the forbidden-pattern gate."""

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

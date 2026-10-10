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
from __future__ import annotations

import re
import sys
from pathlib import Path

from verify_gate_lexer import mask_code
from verify_gate_sources import source_root, test_only_files, test_spans, in_test_span


ALWAYS_FORBIDDEN = [
    (re.compile(r"\bunsafe\b"), "unsafe"),
    (re.compile(r"\btodo!\("), "todo!("),
    (re.compile(r"\bunimplemented!\("), "unimplemented!("),
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

# panic! is test-exempt like unwrap/expect: reject it outside
# #[cfg(test)] code and main.rs boot, and tests use it idiomatically.
UNWRAP_EXPECT = [
    (re.compile(r"\bpanic!\("), "panic!("),
    (re.compile(r"\.unwrap\("), ".unwrap("),
    (re.compile(r"\.expect\("), ".expect("),
]



def is_main_boot(path: Path) -> bool:
    return path.name == "main.rs" and path.parent.name == "src" and "mainframe-daemon" in path.parts


def is_binary_crate(path: Path) -> bool:
    """The daemon binary crate may use `anyhow` at its top level.
    Library crates may not."""
    return "mainframe-daemon" in path.parts


def scan_file(path: Path, test_files: set[Path] | None = None) -> list[str]:
    violations = []
    text = path.read_text(encoding="utf-8")
    raw_lines = text.splitlines()
    masked = mask_code(text)
    masked_lines = masked.splitlines(keepends=True)
    spans = test_spans(masked)
    if test_files is None:
        test_files = test_only_files(source_root(path))
    file_is_test_exempt = is_main_boot(path) or path.resolve() in test_files
    anyhow_exempt = is_binary_crate(path)

    offset = 0
    for idx, code in enumerate(masked_lines):
        source = raw_lines[idx].strip()

        for pattern, label in ALWAYS_FORBIDDEN:
            if label == "anyhow" and anyhow_exempt:
                continue
            if pattern.search(code) and not FORBID_DECLARATION.search(code):
                violations.append(f"{path}:{idx + 1}: forbidden pattern `{label}`: {source}")

        for pattern, label in UNWRAP_EXPECT:
            for match in pattern.finditer(code):
                if not file_is_test_exempt and not in_test_span(spans, offset + match.start()):
                    violations.append(f"{path}:{idx + 1}: forbidden pattern `{label}`: {source}")
        offset += len(code)

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
    test_files = test_only_files(crates_dir)
    for path in sorted(crates_dir.rglob("*.rs")):
        all_violations.extend(scan_file(path, test_files))

    if all_violations:
        print(f"verify-gate: {len(all_violations)} forbidden-pattern violation(s):\n")
        for v in all_violations:
            print(f"  {v}")
        return 1

    print("verify-gate: no forbidden patterns found.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

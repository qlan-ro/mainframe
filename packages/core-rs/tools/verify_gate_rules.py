"""Token-aware enforcement for daemon conventions."""
from __future__ import annotations

import re
import os
from pathlib import Path

from verify_gate_lexer import mask_code
from verify_gate_sources import in_test_span, test_spans

RETIRED = re.compile("PORT" r" STATUS|packages/core" "/")

MACRO = re.compile(r'\b(?:tracing::)?(?:(?:trace|debug|info|warn|error)(?:_span)?|span|event)!\s*[(\[{]')


def delimiters(code: str, start: int) -> int:
    stack = []
    for pos in range(start, len(code)):
        char = code[pos]
        if char in '([{':
            stack.append(char)
        elif char in ')]}':
            if not stack:
                return pos
            stack.pop()
            if not stack:
                return pos + 1
    return len(code)


def returns_string_error(signature: str) -> bool:
    for match in re.finditer(r'\bResult\s*<', signature):
        depth = 1
        comma = None
        for pos in range(match.end(), len(signature)):
            char = signature[pos]
            if char == '<':
                depth += 1
            elif char == '>':
                depth -= 1
                if depth == 0:
                    if comma is not None and signature[comma + 1:pos].strip() == 'String':
                        return True
                    break
            elif char == ',' and depth == 1:
                comma = pos
    return False


class Scan:
    def __init__(self, path: Path, test_files: set[Path]):
        self.path = path
        self.text = path.read_text(encoding='utf-8')
        self.code = mask_code(self.text)
        self.spans = test_spans(self.code, self.text)
        self.is_test = path.resolve() in test_files
        self.violations = []

    def report(self, pos, label):
        line = self.text.count('\n', 0, pos) + 1
        self.violations.append(f'{self.path}:{line}: {label}')

    def production(self, pos):
        return not self.is_test and not in_test_span(self.spans, pos)


def scan_conventions(path: Path, test_files: set[Path], sleep_allowed: set[str] = frozenset()) -> list[str]:
    scan = Scan(path, test_files)
    scan_basic(scan, sleep_allowed)
    scan_signatures(scan)
    scan_discards(scan)
    return scan.violations


def scan_basic(scan: Scan, sleep_allowed: set[str]):
    path, text, code = scan.path, scan.text, scan.code
    report, production = scan.report, scan.production
    for match in RETIRED.finditer(text):
        report(match.start(), 'retired source reference')
    if path.name in ('lib.rs', 'main.rs') and path.parent.name == 'src':
        if not re.search(r'#!\s*\[\s*forbid\s*\(\s*unsafe_code\s*\)\s*\]', code):
            report(0, 'missing #![forbid(unsafe_code)]')
    for match in re.finditer(r'#\s*!?\s*\[\s*allow\s*\(', code):
        if production(match.start()):
            report(match.start(), 'production allow requires expect with reason')
    for match in re.finditer(r'\b(?:e?println)!\s*\(', code):
        if production(match.start()) and not ('mainframe-daemon' in path.parts and 'cli' in path.parts):
            report(match.start(), 'printing outside daemon CLI subcommands')
    for match in re.finditer(r'\bsleep\s*\(', code):
        if not production(match.start()) and not any(path.as_posix().endswith(p) for p in sleep_allowed):
            report(match.start(), 'test sleep outside polling helper or real-child allowlist')


def scan_signatures(scan: Scan):
    path, text, code = scan.path, scan.text, scan.code
    report, production = scan.report, scan.production
    for match in MACRO.finditer(code):
        end = delimiters(code, match.end() - 1)
        if re.search(r'\b(?:module\s*=|target\s*:)', code[match.end():end]):
            report(match.start(), 'tracing uses the module path target implicitly')
    for match in public_functions(code):
        end = re.search(r'[;{]', code[match.end():])
        signature = code[match.end():match.end() + end.start()] if end else ''
        if production(match.start()) and returns_string_error(signature):
            report(match.start(), 'public signature returns Result<_, String>')


def scan_discards(scan: Scan):
    path, text, code = scan.path, scan.text, scan.code
    report, production = scan.report, scan.production
    for match in re.finditer(r'\blet\s+_\s*=', code):
        if not production(match.start()):
            continue
        end = statement_end(code, match.end())
        expression = code[match.end():end]
        if not re.search(r'\w+\s*\(', expression) or re.search(r'\b(?:send|try_send)\s*\(', expression):
            continue
        start_line = text.rfind('\n', 0, match.start()) + 1
        adjacent_start = text.rfind('\n', 0, max(0, start_line - 1)) + 1
        line_end = text.find('\n', end + 1)
        adjacent_end = text.find('\n', line_end + 1) if line_end >= 0 else -1
        context = text[adjacent_start:adjacent_end if adjacent_end >= 0 else len(text)]
        if '/* expected */' not in context and not re.search(r'\bwarn!\s*\(', mask_code(context)):
            report(match.start(), 'discarded call requires /* expected */ or adjacent warn!')


def measured_lines(path: Path, test_files: set[Path]) -> int:
    text = path.read_text(encoding='utf-8')
    if path.resolve() in test_files:
        return len(text.splitlines())
    spans = test_spans(mask_code(text), text)
    # Preserve production portions of mixed lines while excluding test-only lines.
    positions, offset = [], 0
    for line in text.splitlines(keepends=True):
        positions.append(any(not in_test_span(spans, offset + i) for i, c in enumerate(line) if not c.isspace()))
        if not line.strip():
            positions[-1] = not in_test_span(spans, offset)
        offset += len(line)
    return sum(positions)


def check_lengths(crates: Path, limits: dict[str, int], test_files: set[Path]) -> list[str]:
    violations = []
    for path in sorted(crates.rglob('*.rs')):
        count = measured_lines(path, test_files)
        limit = limits.get(path.relative_to(crates).as_posix(), 300)
        if count > max(300, limit):
            violations.append(f'{path}:1: file length {count} exceeds ratchet {max(300, limit)}')
    return violations


def statement_end(code: str, start: int) -> int:
    pos = start
    while pos < len(code) and code[pos] != ';':
        pos = delimiters(code, pos) if code[pos] in '([{' else pos + 1
    return pos


def public_functions(code: str):
    pattern = r'\bpub(?:\([^)]*\))?\s+(?:async\s+)?(?:unsafe\s+)?fn\b'
    yield from re.finditer(pattern, code)
    for trait in re.finditer(r'\bpub(?:\([^)]*\))?\s+trait\s+\w+[^{}]*{', code):
        end = delimiters(code, trait.end() - 1)
        yield from re.compile(r'\bfn\b').finditer(code, trait.end(), end)


def check_retired_sources(root: Path) -> list[str]:
    violations = []
    for directory, children, files in os.walk(root):
        children[:] = [name for name in children if name not in ('target', '.git', '__pycache__', 'node_modules')]
        for name in files:
            path = Path(directory) / name
            if path.suffix == '.rs':
                continue
            try:
                text = path.read_text(encoding='utf-8')
            except (UnicodeError, OSError):
                continue
            for match in RETIRED.finditer(text):
                line = text.count('\n', 0, match.start()) + 1
                violations.append(f'{path}:{line}: retired source reference')
    return violations

"""Token-aware enforcement for daemon conventions."""
from __future__ import annotations

import re
import os
from pathlib import Path

from verify_gate_lexer import mask_code
from verify_gate_sources import in_test_span, test_spans

RETIRED = re.compile("PORT" r" STATUS|packages/core" "/")

MACRO = re.compile(r'\b(?:tracing::)?(?:(?:trace|debug|info|warn|error)(?:_span)?|span|event)!\s*[(\[{]')

CHANNEL_SEND = re.compile(
    r'\s*(?:\w+\.)*'
    r'(?:\w*(?:sender|tx|channel|bcast)|broadcast|bus|emit|emitter|done|waiters|signals)'
    r'\s*\.(?:send|try_send)\s*\(.*\)\s*', re.S,
)


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
    for match in re.finditer(r'\b(?:e?print(?:ln)?|dbg)!\s*[(\[{]', code):
        if production(match.start()) and not ('mainframe-daemon' in path.parts and 'cli' in path.parts):
            report(match.start(), 'printing outside daemon CLI subcommands')
    for match in re.finditer(r'\bsleep\s*\(', code):
        if not production(match.start()) and not sleep_exempt(scan, match.start(), sleep_allowed):
            report(match.start(), 'test sleep outside polling helper or real-child allowlist')


def sleep_exempt(scan: Scan, position: int, allowed: set[str]) -> bool:
    pattern = r'^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)\s*\('
    for function in re.finditer(pattern, scan.code, re.M):
        body = scan.code.find('{', function.end())
        if body < 0 or not body < position < delimiters(scan.code, body):
            continue
        return any(
            entry.endswith('::' + function[1])
            and scan.path.as_posix().endswith(entry.rsplit('::', 1)[0])
            for entry in allowed
        )
    return False


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
        if not re.search(r'\w+\s*\(|\w+\s*!\s*[(\[{]|\.\s*await\b', expression):
            continue
        if CHANNEL_SEND.fullmatch(expression) and '.await' not in expression:
            continue
        start_line = text.rfind('\n', 0, match.start()) + 1
        line_end = text.find('\n', end + 1)
        previous_start = text.rfind('\n', 0, max(0, start_line - 1)) + 1
        context = text[start_line:line_end if line_end >= 0 else len(text)]
        previous = text[previous_start:start_line].strip()
        if '/* expected */' not in context and previous != '/* expected */':
            report(match.start(), 'discarded call requires /* expected */ or if let Err handling')


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
        name = path.relative_to(crates).as_posix()
        limit = limits.get(name, 300)
        if name in limits and count != limit:
            violations.append(f'{path}:1: measured size {count} must equal ratchet {limit}')
        elif count > limit:
            violations.append(f'{path}:1: file length {count} exceeds ratchet {limit}')
    for name in limits:
        if not (crates / name).is_file():
            violations.append(f'{name}: remove the ratchet entry for the missing file')
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

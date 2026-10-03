"""Resolve test-only Rust source membership from masked module declarations."""
from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

from verify_gate_lexer import mask_code

ATTRS = r'(?:#\s*\[[^\]]*\]\s*)*'
CFG_TEST = re.compile(r'#\s*\[\s*cfg\s*\(\s*test\s*\)\s*\]')
MODULE = re.compile(ATTRS + r'(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*([;{])')
INCLUDE = re.compile(r'\binclude\s*!\s*\(([^)]*)\)')
PATH = re.compile(r'#\s*\[\s*path\s*=([^\]]+)\]')


def source_root(path: Path) -> Path:
    for parent in path.resolve().parents:
        if (parent / 'Cargo.toml').is_file():
            return parent
    return path.resolve().parent


def braces(masked: str) -> dict[int, int]:
    stack, pairs = [], {}
    for match in re.finditer(r'[{}]', masked):
        if match[0] == '{':
            stack.append(match.start())
        elif stack:
            pairs[stack.pop()] = match.end()
    return pairs


def test_spans(masked: str) -> list[tuple[int, int]]:
    pairs = braces(masked)
    spans = []
    for attr in CFG_TEST.finditer(masked):
        end = re.search(r'[;{]', masked[attr.end():])
        if end:
            pos = attr.end() + end.start()
            stop = pairs.get(pos) if end[0] == '{' else pos + 1
            if stop is not None:
                spans.append((attr.start(), stop))
    return spans


def in_test_span(spans: list[tuple[int, int]], offset: int) -> bool:
    return any(start <= offset < end for start, end in spans)


def literal_path(text: str) -> str | None:
    value = text.strip()
    raw = re.fullmatch(r'r(#*)"(.*)"\1', value, re.S)
    if raw:
        return raw[2]
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, str) else None
    except ValueError:
        return None


def explicit_path(match: re.Match, text: str) -> str | None:
    attr = PATH.search(match[0])
    if attr is None:
        return None
    start, end = attr.span(1)
    return literal_path(text[match.start() + start:match.start() + end])


def module_directory(path: Path) -> Path:
    return path.parent if path.stem in ('lib', 'main', 'mod') else path.with_suffix('')


def module_targets(path: Path, text: str, masked: str):
    pairs = braces(masked)
    modules = list(MODULE.finditer(masked))
    for match in modules:
        base = module_directory(path)
        parents = [
            m for m in modules
            if m[2] == "{" and m.start() < match.start()
            and pairs.get(m.end() - 1, 0) > match.start()
        ]
        for parent in parents:
            base /= explicit_path(parent, text) or parent[1]
        override = explicit_path(match, text)
        if match[2] != ';':
            continue
        if override is not None:
            yield match.end() - 1, (base if parents else path.parent) / override
        else:
            yield match.end() - 1, base / (match[1] + '.rs')
            yield match.end() - 1, base / match[1] / 'mod.rs'


def references(path: Path, text: str):
    masked = mask_code(text)
    spans = test_spans(masked)
    for pos, target in module_targets(path, text, masked):
        if target.is_file():
            yield target.resolve(), in_test_span(spans, pos)
    for match in INCLUDE.finditer(masked):
        target = literal_path(text[slice(*match.span(1))])
        if target is not None and (path.parent / target).is_file():
            yield (path.parent / target).resolve(), in_test_span(spans, match.start())


def integration_test(path: Path) -> bool:
    relative = path.relative_to(source_root(path))
    return relative.parts[0] == 'tests'


def test_only_files(root: Path) -> set[Path]:
    files = {p.resolve() for p in root.rglob('*.rs')}
    incoming = defaultdict(list)
    for owner in files:
        for target, gated in references(owner, owner.read_text(encoding='utf-8')):
            incoming[target].append((owner, gated))

    def test_only(path: Path, visiting: frozenset[Path]) -> bool:
        if path in visiting or (path.parent.name == "src" and path.name in ("lib.rs", "main.rs")):
            return False
        owners = incoming[path]
        if not owners:
            return integration_test(path)
        return all(gated or test_only(owner, visiting | {path}) for owner, gated in owners)

    return {path for path in files if test_only(path, frozenset())}

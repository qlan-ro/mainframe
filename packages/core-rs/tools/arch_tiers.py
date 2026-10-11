#!/usr/bin/env python3
"""Render dependency tiers from normal workspace dependencies (excluding tests)."""
from __future__ import annotations

import re
from pathlib import Path

START = '<!-- BEGIN GENERATED CRATE TIERS -->'
END = '<!-- END GENERATED CRATE TIERS -->'


def read_manifest(path: Path) -> tuple[str, set[str]]:
    section = ''
    name = None
    dependencies = set()
    for line in path.read_text().splitlines():
        line = line.strip()
        if line.startswith('['):
            section = line.strip('[]')
        elif section == 'package' and line.startswith('name'):
            name = line.split('=', 1)[1].strip().strip('"')
        elif section == 'dependencies' or (section.startswith('target.') and section.endswith('.dependencies')):
            match = re.match(r'([\w-]+)\s*=', line)
            if match:
                package = re.search(r'package\s*=\s*"([^"]+)"', line)
                dependencies.add(package[1] if package else match[1])
    if name is None:
        raise ValueError(f'missing package name: {path}')
    return name, dependencies


def render(crates: Path) -> str:
    manifests = [read_manifest(p) for p in sorted(crates.glob('*/Cargo.toml'))]
    names = {name for name, _ in manifests}
    graph = {name: sorted(names.intersection(deps)) for name, deps in manifests}
    tiers = {}

    def tier(name, visiting=frozenset()):
        if name in visiting:
            raise ValueError(f'cyclic crate dependency: {name}')
        if name not in tiers:
            tiers[name] = max((tier(dep, visiting | {name}) + 1 for dep in graph[name]), default=0)
        return tiers[name]

    lines = ['| Tier | Crate | Internal dependencies |', '|---|---|---|']
    for name in sorted(graph, key=lambda name: (tier(name), name)):
        deps = ', '.join(f'`{dep}`' for dep in graph[name]) or '—'
        lines.append(f'| {tier(name)} | `{name}` | {deps} |')
    return '\n'.join(lines)


def check_document(crates: Path, document: Path) -> list[str]:
    text = document.read_text()
    if text.count(START) != 1 or text.count(END) != 1:
        return [f'{document}: missing or duplicate generated crate-tier markers']
    actual = text.split(START, 1)[1].split(END, 1)[0].strip()
    return [] if actual == render(crates) else [f'{document}: crate-tier table differs from tools/arch_tiers.py']


if __name__ == '__main__':
    print(render(Path(__file__).resolve().parents[1] / 'crates'))

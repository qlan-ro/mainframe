#!/usr/bin/env python3
"""Render dependency tiers from normal workspace dependencies (excluding tests)."""
from __future__ import annotations

import tomllib
from pathlib import Path

START = '<!-- BEGIN GENERATED CRATE TIERS -->'
END = '<!-- END GENERATED CRATE TIERS -->'


def read_manifest(path: Path) -> tuple[str, set[str]]:
    manifest = tomllib.loads(path.read_text())
    tables = [manifest.get('dependencies', {})]
    tables.extend(target.get('dependencies', {}) for target in manifest.get('target', {}).values())
    dependencies = {
        value.get('package', key) if isinstance(value, dict) else key
        for table in tables for key, value in table.items()
    }
    return manifest['package']['name'], dependencies


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

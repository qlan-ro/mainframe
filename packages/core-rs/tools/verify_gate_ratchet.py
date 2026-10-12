"""Compare ratchet limits with the pull request's base, when available."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path


def compare_limits(current: dict[str, int], previous: dict[str, int]) -> list[str]:
    return [
        f'file_length_ratchet.json: {name}: ratchet cannot grow from {previous.get(name, 300)} to {limit}'
        for name, limit in current.items()
        if limit > previous.get(name, 300)
    ]


def check_ratchet(crates: Path, limits: dict[str, int]) -> list[str]:
    root = crates.resolve().parents[2]
    base = os.environ.get('GITHUB_BASE_REF', 'main')
    ref = f'origin/{base}'
    merge_base = subprocess.run(
        ['git', 'merge-base', 'HEAD', ref], cwd=root, text=True, capture_output=True,
    )
    if merge_base.returncode:
        print('verify-gate: base ratchet comparison skipped: merge-base unavailable', file=sys.stderr)
        return []
    path = 'packages/core-rs/tools/file_length_ratchet.json'
    previous = subprocess.run(
        ['git', 'show', f'{merge_base.stdout.strip()}:{path}'],
        cwd=root, text=True, capture_output=True,
    )
    if previous.returncode:
        print('verify-gate: base ratchet comparison skipped: base ratchet unavailable', file=sys.stderr)
        return []
    return compare_limits(limits, json.loads(previous.stdout))

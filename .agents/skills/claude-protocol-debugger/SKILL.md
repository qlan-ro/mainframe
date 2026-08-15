---
name: claude-protocol-debugger
description: Use when investigating Claude CLI protocol behavior — stream-json event mismatches, permission handling, control_request/response fields, or any question about what the CLI actually does internally. Covers live event debugging, JSONL history comparison, and binary reverse-engineering.
---

# Claude Protocol Debugger

## Overview

The Claude CLI communicates via a JSON-RPC-like protocol over stdio. This skill covers three debugging techniques:

1. **Live event inspection** — debug mismatches between stream-json events and JSONL history
2. **Daemon log analysis** — inspect control_request/response payloads as logged by the daemon
3. **Binary reverse-engineering** — read the CLI's minified JS source to verify protocol behavior

## When to Use

- Feature works after daemon restart (history path) but not during live sessions
- Fields are missing or named differently in live mode vs JSONL
- Permission responses aren't being persisted or honored
- Need to verify what the CLI actually does with a protocol field
- Investigating undocumented CLI behavior or protocol edge cases

## Technique 1: Live Event Inspection

For snake_case vs camelCase field mappings, debug logging patterns, and daemon log analysis techniques, see [`protocol-findings.md`](protocol-findings.md). Read it before starting any event debugging.

## Technique 2: Daemon Log Analysis

See [`protocol-findings.md`](protocol-findings.md) for grep patterns and Python extraction scripts.

## Technique 3: Binary Reverse-Engineering

The Claude CLI binary is a bundled Node.js SEA (Single Executable Application) with **readable minified JS** embedded in it. Use this when docs are incomplete or you need to verify what the CLI actually does with a protocol field.

> **Before re-reversing the binary**, read [`cli-binary-internals.md`](cli-binary-internals.md) in this directory. It contains previously reverse-engineered findings (v2.1.85) including the stdio message loop, interrupt handling, REPL bridge, abort controller chain, and background agent wait loop. Read it first to avoid duplicate work.

### Locate the binary

```bash
# Find the CLI version and binary
claude --version  # e.g. 2.1.85
ls ~/.local/share/claude/versions/
# Binary is at: ~/.local/share/claude/versions/<version> (the version IS the binary, not a directory)
```

### Extract and search the JS source

**Prefer Python `re.finditer` over `strings | grep`** — the binary contains enormous minified JS lines, and `strings | grep` returns megabytes of irrelevant context. Use offset-based extraction:

```python
import re
CLI_BIN = "~/.local/share/claude/versions/2.1.85"  # adjust version

with open(CLI_BIN, 'rb') as f:
    data = f.read()

# Search for exact byte pattern
pattern = b'case"interrupt"'
for m in re.finditer(pattern, data):
    start = max(0, m.start() - 300)
    end = min(len(data), m.end() + 500)
    chunk = data[start:end].decode('ascii', errors='replace')
    print(f'=== offset {m.start()} ===')
    print(chunk)
```

For broader searches, `strings` still works but pipe through `wc -l` first to gauge volume:

```bash
CLI_BIN=~/.local/share/claude/versions/$(claude --version | head -1)
strings "$CLI_BIN" | grep -c "your_pattern"  # check count first
```

### Previous findings

All previously reverse-engineered details (string literals, minified function tables, call chains, two code paths for control_request, permission persistence, interrupt handling, background agent wait loop) are in [`cli-binary-internals.md`](cli-binary-internals.md). **Read it before starting any new reverse-engineering session.**

## Maintaining Reference Files

This skill has two reference files that accumulate findings across debugging sessions. **Update them when you discover something surprising** — behavior that contradicts expectations, undocumented protocol quirks, or anything that would save time if known upfront next time.

| File | Contents |
|------|----------|
| [`protocol-findings.md`](protocol-findings.md) | Protocol-level knowledge: event pipeline, field casing, daemon log analysis, debug logging patterns, common pitfalls |
| [`cli-binary-internals.md`](cli-binary-internals.md) | Binary reverse-engineering: minified JS structure, code paths, abort chains, agent wait loops, permission persistence |

**What to record:** Things we didn't expect — behavior that surprised us, fields that don't match docs, race conditions, blocking issues. Don't record things that are obvious from reading the code.

**What NOT to record:** Routine findings that match documentation, expected behavior, or things derivable from reading source files.

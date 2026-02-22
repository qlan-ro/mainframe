# Move Claude Adapter Into Builtin Plugin — Design

**Date:** 2026-02-22
**Status:** Approved

## Problem

`ClaudeAdapter` and all its supporting files live in `packages/core/src/adapters/` alongside
generic infrastructure (`BaseAdapter`, `BaseSession`, `AdapterRegistry`). The builtin Claude
plugin just imports from there rather than being self-contained. A third-party adapter plugin
ships everything inside its own directory — the builtin Claude plugin should too.

Additionally, `AdapterRegistry` hardcodes `new ClaudeAdapter()` in its constructor, which
contradicts the plugin system's purpose of being the source of adapter registrations.

## Goal

`packages/core/src/adapters/` contains only generic infrastructure.
`packages/core/src/plugins/builtin/claude/` is fully self-contained.
`AdapterRegistry` starts empty and is populated exclusively by plugins.

## File Moves

| From (`adapters/`) | To (`plugins/builtin/claude/`) |
|---|---|
| `claude.ts` | `adapter.ts` |
| `claude-session.ts` | `session.ts` |
| `claude-events.ts` | `events.ts` |
| `claude-history.ts` | `history.ts` |
| `claude-skills.ts` | `skills.ts` |
| `frontmatter.ts` | `frontmatter.ts` |

## Files That Stay in `adapters/`

- `base.ts` — `BaseAdapter` (generic)
- `base-session.ts` — `BaseSession` (generic)
- `index.ts` — `AdapterRegistry` (generic, constructor becomes empty)

## Import Updates

- `adapters/index.ts` — remove `ClaudeAdapter` import from constructor and re-exports
- `plugins/builtin/claude/index.ts` — update import to local `./adapter.js`
- All test files importing from `../adapters/claude*` — update to `../plugins/builtin/claude/*`

## Tests

All 7 test files that import Claude-specific symbols update their paths directly to the new
plugin location. No barrel re-exports added — tests document exactly what they test.

`AdapterRegistry` tests that relied on the implicit `new ClaudeAdapter()` in the constructor
are updated to either register an adapter explicitly or test the empty registry behavior.

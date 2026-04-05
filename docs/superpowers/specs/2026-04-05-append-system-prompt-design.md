# Append System Prompt for AskUserQuestion

**Issue:** #51
**Date:** 2026-04-05

## Problem

When Claude runs inside Mainframe's GUI, it doesn't know it should use the `AskUserQuestion` tool to gather user input. Instead, it asks questions in plain text, which the user has to respond to by typing. The GUI renders `AskUserQuestion` as interactive, clickable UI elements -- a much better experience.

## Solution

Append a short instruction to Claude's system prompt via the `--append-system-prompt` CLI flag (and the equivalent SDK option). This tells Claude it's running inside a GUI and should prefer `AskUserQuestion` for all user interaction.

## Prompt Text

Defined once as a shared constant:

```
You are running inside Mainframe, a desktop GUI that manages your session.
When you need user input, clarification, or a decision, use the AskUserQuestion
tool -- it renders as an interactive UI element the user can click. Do not ask
questions in plain text.
```

## Changes

### New file: `packages/core/src/plugins/builtin/claude/constants.ts`

Exports `MAINFRAME_SYSTEM_PROMPT_APPEND` -- the shared prompt constant used by both Claude adapters.

### Modified: `packages/core/src/plugins/builtin/claude/session.ts`

Add `'--append-system-prompt', MAINFRAME_SYSTEM_PROMPT_APPEND` to the spawn args array (after existing flags, before `spawn()` call).

### Modified: `packages/core/src/plugins/builtin/claude-sdk/session.ts`

Add `appendSystemPrompt: MAINFRAME_SYSTEM_PROMPT_APPEND` to the options object passed to `query()`.

### Tests

- Update `session-spawn-args.test.ts` to verify the `--append-system-prompt` flag and its value appear in spawn args.
- Add a test for the SDK adapter to verify `appendSystemPrompt` is passed to `query()`.

## What Doesn't Change

- `SessionSpawnOptions` type -- no new fields (prompt is hardcoded per-adapter, not configurable).
- `lifecycle-manager.ts` -- no changes.
- Desktop/UI -- no changes.

## Trade-offs

- The prompt is visible in `ps` output. This is acceptable since it contains no secrets.
- Hardcoded, not configurable. Keeps the implementation simple; can be made configurable later if needed.

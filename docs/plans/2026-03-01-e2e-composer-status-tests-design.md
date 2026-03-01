# E2E Tests: Composer, Context Usage & Chat Status

## Goal

Add Playwright E2E tests covering three untested UI areas:

1. **Composer attachments** — file attach, display, removal, and AI processing
2. **Composer context picker** — @mentions (files) and /commands (skills), selection, insertion, and AI round-trips
3. **Chat session bar** — status indicator (Thinking/Awaiting/idle) and context usage progress

All tests use real AI round-trips (Haiku model) matching the existing test conventions.

## Test Files

### `30-composer-attachments.spec.ts`

| Test | What it verifies |
|------|-----------------|
| Attach an image file | Seed a PNG, attach via file input, `attachment-thumb` appears |
| Send message with attachment | AI acknowledges the image content |
| Remove attachment before sending | Click X, attachment disappears from `composer-attachments` |

### `31-composer-context-picker.spec.ts`

| Test | What it verifies |
|------|-----------------|
| `/` opens picker with skills | `context-picker-menu` visible, skill items present |
| Selecting a skill inserts it | Composer text becomes `/{skillName} ` |
| `@` opens picker with files | Picker shows file items from seeded project |
| Selecting a file inserts @mention | Composer text updates with `@path` |
| Escape closes picker | Picker hides on Escape |
| Send message with @mention | AI references the mentioned file content |

### `32-chat-status-context.spec.ts`

| Test | What it verifies |
|------|-----------------|
| Status shows "Thinking" while working | "Thinking" text visible during AI processing |
| Session bar shows adapter label | "Claude" label visible |
| Context usage appears after response | Non-zero `%` in session bar |
| Context usage increases over turns | Percentage grows with conversation length |

## Required UI Changes

Add `data-testid` attributes to `ChatSessionBar.tsx`:

- `data-testid="session-bar"` on root container
- `data-testid="session-bar-status"` on StatusIndicator wrapper
- `data-testid="session-bar-context-pct"` on the percentage `<span>`
- `data-testid="session-bar-adapter"` on the adapter label

These enable reliable test selectors without brittle CSS class matching.

## Conventions

- One `launchApp()`/`closeApp()` lifecycle per file
- `acceptEdits` permission mode (avoids plan approval interruptions)
- Seeded test project with known files (CLAUDE.md, index.ts, utils.ts)
- Timeouts: 60s default for AI, 90s for multi-tool responses
- Follows existing file numbering (30, 31, 32)

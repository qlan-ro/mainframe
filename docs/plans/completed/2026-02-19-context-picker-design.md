# Context Picker Design

**Date:** 2026-02-19
**Status:** Approved

## Problem

The `@` button in the composer inserts `@` into the text but the popup never appears
because file search requires `query.length >= 2` and the empty-query menu returns `null`.
Additionally the button only covered agents and files — skills required typing `/` separately.

## Goal

A single **context picker** popup that gives access to agents, files, and skills from
one entry point, while keeping the keyboard-native `@` and `/` triggers working.

## Behavior

### Button trigger
- **Icon:** Combined `/@` symbol (replaces `AtSign`)
- **Action:** Opens picker in `all` mode showing all agents + all skills immediately
- Files are **not searchable** in this mode — a static hint reads "type `@` to search files"
- Selecting an agent inserts `@agent-name ` into the composer
- Selecting a skill inserts `/skill-name ` into the composer

### Typing `@` in the composer
- Picker opens in `agents-files` mode
- Shows agents filtered by query (client-side fuzzy match)
- File search activates at `query.length >= 1` (server-side, debounced 150 ms)
- Empty `@` query shows all agents + "type to search files…" hint
- Selecting inserts `@name ` or `@file/path ` replacing the `@query` token

### Typing `/` in the composer
- Picker opens in `skills` mode (same as today's `SlashCommandMenu`)
- Shows skills filtered by query
- Selecting inserts `/skill-name ` replacing the `/query` token

### Escape
- Removes the active trigger token from the text
- Resets `forceOpen` if button-triggered

## Architecture

### Replace `AtMentionMenu` + `SlashCommandMenu` with `ContextPickerMenu`

```
ComposerCard
  ComposerPrimitive.Root
    ContextPickerMenu          ← new, replaces both menus
      props: forceOpen, onClose
    ...composer body...
    [/@] button                ← updated icon + sets forceOpen=true
```

**Filter modes:**

| Mode | Trigger | Shows |
|------|---------|-------|
| `all` | Button click | Agents + Skills + files hint |
| `agents-files` | Text contains `(?:^|\s)@(\S*)$` | Agents + Files |
| `skills` | Text contains `(?:^|\s)\/(\S*)$` | Skills only |

**State in `ContextPickerMenu`:**
- `forceOpen: boolean` prop — set by button, cleared on select/Escape
- `filterMode` derived from text regex + `forceOpen`
- `query` extracted from active text trigger (empty when `forceOpen` and no trigger)
- `fileResults` from debounced server search (only in `agents-files` mode, `query >= 1`)

**On selection:**
- If text trigger active: replace `@query` or `/query` token with the chosen item
- If button-triggered (no token): prepend `@name ` or `/name ` to existing text

## Files Changed

- `packages/desktop/src/renderer/components/chat/ContextPickerMenu.tsx` — new file
- `packages/desktop/src/renderer/components/chat/assistant-ui/composer/ComposerCard.tsx` — wire `forceOpen`, new button icon
- Remove `AtMentionMenu.tsx` and `SlashCommandMenu.tsx` (or keep and deprecate)
- `packages/core/src/server/routes/files.ts` — lower `q.length` threshold from `< 2` to `< 1`

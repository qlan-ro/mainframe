# @ Mention Feature Design

## Overview

Add `@` mention autocomplete to the composer, allowing users to reference files and agents inline. Typing `@` or clicking the AtSign button opens a flat suggestion menu with fuzzy filtering.

## Activation

- **Typing:** `@` preceded by a space or at position 0 opens the menu. Query = characters after `@` up to cursor. Regex: `/(?:^|\s)@(\S*)$/` matched against text up to cursor position.
- **Button click:** Clicking the existing AtSign button appends `@` to the current text and focuses the input, which triggers the typing detection.
- **Dismissal:** Escape, deleting the `@` character, selecting an item, or cursor moving before the `@`.
- Mutually exclusive with SlashCommandMenu — only one shows at a time.

## Data Sources

- **Agents** — from `useSkillsStore().agents`, already in memory.
- **Files** — fetched lazily from a new `GET /api/projects/:id/files` endpoint on first `@` activation. Returns flat array of relative paths. Cached in a ref, re-fetched on project change.

No skills (they have `/` commands), no sub-categories.

## Filtering & Display

- Empty query (`@` alone): show agents first, then first ~20 files.
- With query: fuzzy match across both, interleaved by relevance.
- Max ~50 visible results with scroll.
- Each row: type badge (`agent` | `file`), name, truncated description (agents) or parent directory (files).
- Sorting: exact prefix matches first, agents before files at equal relevance, alphabetical within tier.

## Selection & Insertion

- Selecting an item replaces `@query` with `@exact-name` (e.g., `@gsd-executor` or `@src/main/index.ts`).
- A space is appended after the mention; cursor placed after it.
- Plain text in textarea — no rich formatting while editing.

## Message Rendering

- After sending, mentions in displayed messages are detected via regex `/(?:^|\s)@([\w.\/\-]+)/g`.
- Rendered as styled inline spans: semi-bold, accent background, small rounded corners.

## Keyboard Navigation

Same pattern as SlashCommandMenu: ArrowUp/Down, Enter/Tab to select, Escape to dismiss. Global keydown listener with capture phase.

## Changes

### Backend (`packages/core`)

- `server/http.ts` — New `GET /api/projects/:id/files` endpoint. Walks project tree recursively, returns flat array of relative paths. Filters `.dotfiles` and `node_modules`. Capped at ~5000 entries.

### Client (`packages/desktop`)

- `lib/client.ts` — Add `getFiles(projectId)` method.
- `components/chat/AtMentionMenu.tsx` — New component (~160 lines), modeled after SlashCommandMenu.
- `components/chat/assistant-ui/MainframeThread.tsx` — Render AtMentionMenu inside composer, add onClick to AtSign button.
- `components/chat/assistant-ui/parts/MainframeText.tsx` — Mention detection regex + styled inline spans.

### Not changed

Types package, stores, runtime provider, message conversion.

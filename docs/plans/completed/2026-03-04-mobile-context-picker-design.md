# Mobile Composer Context Picker

## Overview

Add inline autocomplete to the mobile composer for slash commands, skills, @file mentions, and @agent mentions — matching desktop feature parity.

## Triggers

- `/` at start of input → filter skills + custom commands
- `@` after whitespace or at start → filter agents + fuzzy file search
- Dropdown appears above composer, filters as user types
- Tap item to select → inserts token into composer text, closes dropdown

## Data Sources

| Source | Endpoint | Cache |
|--------|----------|-------|
| Commands | `GET /api/commands` | Per session |
| Skills | `GET /api/adapters/:adapterId/skills?projectPath=...` | Per session |
| Files | `GET /api/projects/:id/search/files?q=...&limit=20` | Debounced 200ms |
| Agents | From skills endpoint (agent configs) | Per session |

## Item Types

| Type | Icon | Display | Insert |
|------|------|---------|--------|
| Skill | Zap | `/name` + scope badge + description | `/invocationName ` |
| Command | Wrench | `/name` + description | `/name ` |
| File | File | `@path/to/file` | `@path/to/file ` |
| Agent | Bot | `@name` + scope badge | `@name ` |

## Components

- **`useContextPicker.ts`** — hook: trigger detection from text cursor, data fetching, filtering, item selection
- **`ContextPickerList.tsx`** — FlatList dropdown rendered above composer, dark theme matching app style
- **`Composer.tsx`** — integrate trigger detection, render picker, handle item insertion
- **`lib/api.ts`** — add `getCommands()`, `getSkills()`, `searchFiles()`, `registerMention()`
- **`DaemonClient.sendMessage`** — accept `metadata` param for command routing

## Send Behavior

- If message starts with `/command`, attach `metadata.command = { name, source }` to `message.send`
- `@mentions` extracted server-side by existing `extractMentionsFromText` in core
- Agent @mentions: register via `POST /api/chats/:id/mentions` on send

## Scope

Full parity: commands, skills, @files, @agents. No text highlighting in v1 (mobile TextInput doesn't support overlays like the desktop transparent-text trick).

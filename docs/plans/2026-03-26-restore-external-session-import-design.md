# Restore External Session Import UI

## Problem

The unified session view (commit 34cc461) removed the external session import UI from `ChatsPanel.tsx`. The backend, API, store state, and WS event handling all still work — only the frontend trigger is missing.

## Design

Add a **Download** icon button to the `ChatsPanel` header (alongside Add Project, New Session, View Toggle). The button opens a popover for browsing and importing external sessions.

### Button behavior

| State | Behavior |
|-------|----------|
| `externalSessionCount === 0` | Disabled, tooltip: "No external sessions found" |
| `externalSessionCount > 0`, project filter active | Click opens session list for that project |
| `externalSessionCount > 0`, "All" filter (no project selected) | Click opens project picker first, then session list |

### Popover: Project picker

Shown when no project filter is active. Same visual style as `NewSessionPopover`. Selecting a project transitions to the session list for that project.

### Popover: Session list

Fetches `getExternalSessions(projectId)` on mount. Shows each session as a row:

- **First prompt** (truncated, primary text)
- **Git branch** + **relative time** (secondary text)
- **Import button** per row

On import:
1. Call `importExternalSession(projectId, sessionId, adapterId, title)`
2. Add returned `Chat` to store via `addChat()`
3. Close the popover

### Existing infrastructure (no changes needed)

- `externalSessionCount` + `setExternalSessionCount` in chats store
- `sessions.external.count` WS event handler in `ws-event-router.ts`
- `loadExternalSessions()` in `useAppInit.ts` / `useProject` hook
- `getExternalSessions()` and `importExternalSession()` API functions
- Backend routes, service, and auto-scan

### Files to modify

- `packages/desktop/src/renderer/components/panels/ChatsPanel.tsx` — add button + popover

### Files to add

- `packages/desktop/src/renderer/components/panels/ImportSessionsPopover.tsx` — popover component (project picker + session list)

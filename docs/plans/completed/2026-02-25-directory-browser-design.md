# Directory Browser: Replace Electron File Picker with Daemon-Side Browsing

## Problem

The "Add project" flow depends on `window.mainframe.openDirectoryDialog()`, an Electron IPC call to the native file picker. This breaks in browser mode (`dev:web`) and violates the thin-client architecture — the renderer should not need Electron APIs for filesystem access.

## Decision

Replace the Electron-dependent file picker with a daemon-side directory browser. The daemon already handles filesystem operations; directory browsing belongs there too.

## Design

### Daemon Endpoint

**`GET /api/filesystem/browse?path=<dir>`** — added to existing `files.ts`

- `path` defaults to `os.homedir()` when omitted
- Validates path is under `os.homedir()` via `resolveAndValidatePath`
- Returns directories only (no files), hides dotfiles, sorts alphabetically
- Reuses existing `readdir` + `IGNORED_DIRS` filtering pattern
- Response: `{ path: string, entries: Array<{ name: string, path: string }> }`
- Zod schema for query params in `schemas.ts`
- Wrapped in `asyncHandler` like all other routes

### Renderer API Client

- Add `browseFilesystem(path?: string)` to the API module
- Calls `GET /api/filesystem/browse?path=...` via existing `fetchJson` helper

### UI: DirectoryPickerModal

New component: `DirectoryPickerModal.tsx`

- Modal overlay with a directory tree
- Starts at `~`, shows sorted subdirectories
- Click a folder to expand (lazy-loads children via API)
- Current path displayed at bottom
- "Select" confirms, "Cancel" dismisses
- Returns selected path string to caller

### TitleBar Integration

- `handleAddProject` opens `DirectoryPickerModal` instead of calling `window.mainframe.openDirectoryDialog()`
- On selection, calls `createProject(path)` as before
- Works identically in Electron and browser

### Cleanup

- Remove `openDirectoryDialog` from `preload/index.ts` and `MainframeAPI` type
- Remove `dialog:openDirectory` IPC handler from Electron main process
- Remove from `global.d.ts`

## Files to Modify

| File | Change |
|------|--------|
| `packages/core/src/server/routes/files.ts` | Add `GET /api/filesystem/browse` handler |
| `packages/core/src/server/routes/schemas.ts` | Add Zod schema for browse query |
| `packages/desktop/src/renderer/lib/api/` | Add `browseFilesystem()` client function |
| `packages/desktop/src/renderer/components/DirectoryPickerModal.tsx` | New modal component |
| `packages/desktop/src/renderer/components/TitleBar.tsx` | Use modal instead of IPC |
| `packages/desktop/src/preload/index.ts` | Remove `openDirectoryDialog` |
| `packages/desktop/src/renderer/types/global.d.ts` | Remove from type |
| `packages/desktop/src/main/index.ts` | Remove `dialog:openDirectory` IPC handler |

## Verification

1. Run daemon, open `dev:web` in browser — "Add project" opens modal, browse to a directory, select it, project appears
2. Run `dev` (Electron) — same flow works identically
3. Daemon tests: `GET /api/filesystem/browse` returns home dir contents, rejects paths outside `~/`
4. Path traversal: confirm `../../etc` is rejected

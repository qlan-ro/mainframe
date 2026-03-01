# Desktop UX Improvements Design

Four small, self-contained UX improvements to the desktop app.

## 1. Custom CLI Executable Path (Per-Provider)

The Claude adapter spawns `'claude'` via PATH lookup. Users with non-standard installations need to specify the full path.

**Changes:**
- Add `executablePath?: string` to `ProviderConfig` in `@mainframe/types`
- Add "Executable Path" text input in Provider settings section
- Adapter uses `config.executablePath || 'claude'` for spawn and `isInstalled()` calls

**Files:** `packages/types/src/settings.ts`, `packages/core/src/plugins/builtin/claude/adapter.ts`, `packages/core/src/plugins/builtin/claude/session.ts`, `packages/desktop/src/renderer/components/settings/ProviderSection.tsx`

## 2. Show All Dotfiles in File Tree

Currently all entries starting with `.` are filtered. Remove this filter; keep `IGNORED_DIRS` set (node_modules, dist, build, .git, etc.).

**Files:** `packages/core/src/server/routes/files.ts`

## 3. Right-Click Context Menu in Files Tab

Add `onContextMenu` to file tree nodes with two actions:
- **Reveal in Finder** — IPC call to `shell.showItemInFinder(absolutePath)`
- **Copy Path** — `navigator.clipboard.writeText(absolutePath)`

**Files:** `packages/desktop/src/renderer/components/panels/FilesTab.tsx`, `packages/desktop/src/main/preload.ts`, `packages/desktop/src/main/index.ts`

## 4. Disable Text Selection Globally (Except Content Areas)

Add `user-select: none` to the app root. Override with `user-select: text` on chat message content, composer inputs, diff viewer code, and editor content areas.

**Files:** `packages/desktop/src/renderer/index.css`, component-level class additions where needed

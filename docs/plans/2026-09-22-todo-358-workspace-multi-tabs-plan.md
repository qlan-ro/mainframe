# Todo #358 — commit gestures for workspace file tabs

**Route:** no-spec · **Size:** s · **Branch:** `todo/358-workspace-multi-tabs`

## Goal

The workspace surface is already multi-tab; only *file-backed* tabs share one replace-me preview slot per pane per launch scope, and every open-file path requests preview mode because the intent has no way to say otherwise. A user clicking through the file tree therefore sees one tab that keeps being overwritten. Keep single-click-to-preview — it is the deliberate VS Code-style model — and add the conventional commit gestures: double-click, accelerator-click and middle-click on a file-tree row open or promote the file as a **permanent** tab, and the row context menu gains a "Keep open" item. The file-tab reducer already implements focus-existing, promote-on-permanent and the single-preview-slot rule; it needs no behavioral change, only to be *reached* with the requested mode. This is a plumbing + gesture change, no new visual element beyond the menu item.

## Files touched

| File | Change |
| --- | --- |
| `packages/ui/src/store/surface-intents.ts` | `open-file` and `open-diff` variants gain `mode?: TabMode` (import the type from `./run-pane`). Optional — omitted means preview. |
| `packages/ui/src/store/intent-subscriber.ts` | Lines 78 and 105: pass `intent.mode ?? 'preview'` instead of the hard-coded `'preview'`. Update the module docstring bullet that says `openFileTab(path, 'preview')`. |
| `packages/ui/src/features/files/open-mode-from-mouse.ts` *(new)* | Pure helper `openModeForMouseEvent(flags, isMac): TabMode` — accelerator held (⌘ on mac, Ctrl elsewhere) → `'permanent'`, otherwise `'preview'`. Takes plain flags, not an event, so tests need no `navigator` mock (the pattern `platform.ts` documents). |
| `packages/ui/src/features/files/FileTreeNode.tsx` | File row (the `entry.type === 'file'` branch, ~line 96) grows: `onClick` routed through the helper, `onDoubleClick` → permanent, `onMouseUp` with `event.button === 1` → permanent. Directory rows unchanged. |
| `packages/ui/src/features/files/FileTreeRowMenu.tsx` | Adds a "Keep open" item for files only, rendered by a small child component inside `ContextMenuContent` that reads the layout store. |
| `packages/ui/src/features/files/__tests__/FileTree.test.tsx` | New cases for the three gestures and the menu item. |
| `packages/ui/src/store/__tests__/intent-subscriber.test.ts` | New cases for the mode plumbing (permanent accumulates; permanent on an open preview promotes in place with the same tab id). |
| `packages/ui/src/features/files/__tests__/open-mode-from-mouse.test.ts` *(new)* | Table test over the helper. |
| `.changeset/*.md` | Patch for `@qlan-ro/mainframe-ui`. |

## Approach notes the implementer must not re-derive

- **Do not add `mode: 'preview'` to existing emitters.** Roughly fifteen tests assert the intent object *exactly* (`FileTree.test.tsx:56`, `FilePickerDialog.test.tsx:218`, `ContextSection.test.tsx:96`, …). Omitting the field keeps them green; the subscriber's `?? 'preview'` supplies the default. Only the new permanent gestures set `mode`.
- **Double-click works *because* the first click already previewed.** Click 1 emits preview → a preview tab exists. Click 2 emits preview again → `focusExisting` keeps `existing.mode` (`run-pane-file-tabs.ts:93`), so nothing flickers. Then `dblclick` emits `mode: 'permanent'` → `focusExisting` flips the mode on the same tab id. Same id means `WorkspaceSurface.tsx:125` keys the content identically and the buffer is not reloaded. Do not try to suppress the first click's emit.
- **Middle-click uses `onMouseUp` + `event.button === 1`, not `onAuxClick`.** See Decisions.
- **"Keep open" visibility.** Render it from a small child component *inside* `ContextMenuContent` so the layout-store subscription only exists while a menu is open — Radix mounts content lazily, and `FileTreeRowMenu` wraps every row in the tree. Compare `entry.path` against open file tabs the same way `FileTree.tsx:51` already compares `activeFileTab(s.run)?.path` — tree paths and tab paths are both canonical base-relative there. Hide the item when a permanent tab for that path exists; hide it for directories (which also covers the root header, `FileTree.tsx:102`, whose entry is `type: 'directory'`).
- **Testids.** Existing menu items are static (`file-tree-copy-path`). The new one must be path-keyed: `file-tree-keep-open-${entry.path}`. Row testids stay as they are.
- **Line limits.** `FileTreeNode.tsx` is 160 lines and its component function is already long; keep the new handlers to thin call-throughs to the pure helper rather than inline branching. `layout.ts` is 292 lines against the 300 limit — this change must not touch it.

## Risks

- **Ctrl-click on macOS is the context-menu gesture.** Gating on `metaKey` for mac and `ctrlKey` elsewhere (via `isMacPlatform()`) avoids firing a permanent open at the same moment Radix opens the menu. Getting this backwards produces a menu *and* a tab on every mac ctrl-click.
- **Path identity.** If a tree path and a tab path ever diverge in normalization, "Keep open" silently stays visible for an already-permanent file. Low impact (the action is idempotent — it just focuses) and it matches the existing selected-row comparison, so no new risk is introduced.
- **Scope keys.** `sameFile` in the reducer includes `scopeKey`; the tree's visibility check deliberately ignores it, exactly like the existing `activeFilePath` comparison. A file open as permanent in another launch scope hides the menu item in the current scope. Accepted — matching the existing row-selection behavior beats inventing a second rule.
- **The worktree has no `node_modules`.** `pnpm install` in the worktree is an implementer prerequisite, not a task.

## Established facts

- `TabMode = 'preview' | 'permanent'` — `packages/ui/src/store/run-pane.ts:15`.
- The reducer already promotes on permanent and refreshes diff sides without creating a tab — `focusExisting`, `packages/ui/src/store/run-pane-file-tabs.ts:92`, mode resolution at `:93`.
- A permanent open never takes the preview slot: `previewIdx` is computed only when `mode === 'preview'` (`run-pane-file-tabs.ts:130`), otherwise the tab is appended (`:136`).
- Tab content is keyed by tab id (`packages/ui/src/layout/surfaces/WorkspaceSurface.tsx:125`), so an in-place promotion cannot remount the editor.
- Preview pills render italic and the pill's own double-click promotes — `packages/ui/src/layout/WorkspaceTabPill.tsx:80` and `:71`. Both paths are untouched by this change.
- Both intent branches currently hard-code `'preview'` — `packages/ui/src/store/intent-subscriber.ts:78` (open-file) and `:105` (open-diff).
- `isMacPlatform()` is the single `navigator` read in the shortcut layer; every other module takes `isMac` as a parameter — `packages/ui/src/features/shortcuts/platform.ts`. `hintModifierHeld(flags, isMac)` at `features/shortcuts/index-hints.ts:38-40` is the same mod-key rule, but it is documented as owned by the `sessions.tab-by-index` binding and lives beside a zustand store; the new helper duplicates one boolean rather than importing that module.
- `@testing-library/dom` 10.4.1 exposes `dblClick` (`dist/event-map.js:174`, aliased as `doubleClick` at `:710`), `mouseUp` (`:294`), `mouseDown` (`:246`) and `contextMenu` (`:166`). A case-insensitive grep for `aux` in that file returns nothing — **`fireEvent.auxClick` does not exist**; an `auxclick` test would need a hand-built `MouseEvent`.
- `browser-compat-data` is not installed anywhere in `node_modules/.pnpm`, so WebKit's `auxclick` support could not be verified from this repo — hence the `mouseUp` decision below.
- `FileTree.test.tsx:14` mocks `@/store/surface-intents` but leaves the layout store real, so the "Keep open" visibility test drives state with `useLayoutStore.setState({ run })`. Context menus in that suite are opened with `fireEvent.contextMenu(row)` (`FileTree.test.tsx:87`).
- React 19.2.8 (`packages/ui/node_modules/react/package.json`).
- Changesets `fixed` group is `["@qlan-ro/mainframe-types", "@qlan-ro/mainframe-ui"]` — `.changeset/config.json`. This change is a `@qlan-ro/mainframe-ui` patch.
- `docs/plans/` is gitignored (`.gitignore:53`), so this plan is committed with `git add -f`.

## Decisions made while planning

1. **Middle-click binds `onMouseUp` + `button === 1`, not `onAuxClick`.** WebKit's `auxclick` support could not be verified from this repo (no `browser-compat-data`), and `fireEvent.auxClick` does not exist in the installed testing-library, so an `auxclick` binding would be both unverified at runtime and awkward to test. `mouseUp` is universal and `fireEvent.mouseUp(row, { button: 1 })` is a one-liner.
2. **"Keep open" is hidden, not disabled, when the file is already permanent** — following the design direction verdict over the brief's "disabled or hidden".
3. **The visibility check ignores `scopeKey`,** matching the existing selected-row comparison rather than introducing a second path-identity rule.

## Exit gates (owned by the single implementation group)

- Single-clicking two files in sequence still leaves exactly one file tab; double-click leaves a permanent tab and a later single-click on another file leaves two.
- Accelerator-click and middle-click open a permanent tab and leave an existing preview tab intact.
- A permanent request against an already-open preview promotes that tab in place — same tab id, no second tab.
- "Keep open" appears for files, not for directories or the root header, and is absent once the file is permanently open.
- The existing `packages/ui` suite passes unchanged — in particular the pane-model, file-tab reducer, `FilePickerDialog`, `ContextSection` and `WorkspaceEmptyState` intent-shape assertions.
- Typecheck and lint pass for `packages/ui` (typecheck includes test files).
- A `@qlan-ro/mainframe-ui` patch changeset is committed.

## Implementation group (single group, `ui`)

One agent, TDD inline — write each failing assertion and its fix in the same turn.

1. **Pure helper** `open-mode-from-mouse.ts` plus its table test: accelerator held → `'permanent'`, bare click → `'preview'`, mac vs non-mac.
2. **Intent plumbing** — optional `mode` on `open-file` / `open-diff`, forwarded as `intent.mode ?? 'preview'`, with subscriber tests covering both variants: permanent accumulates a second tab; permanent against an already-open preview promotes in place (same tab id, no extra tab).
3. **Tree gestures** on the file row — click through the helper, double-click, `mouseUp` with `button === 1` — with `FileTree` tests asserting the emitted intent shape for each.
4. **"Keep open" menu item** — lazily-mounted child inside `ContextMenuContent`, path-keyed testid, hidden for directories and for already-permanent files.

The changeset and the `packages/ui` suite/typecheck run are this group's exit gates, not separate work.

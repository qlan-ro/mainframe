# ⌘O Spotlight palette — full artboard parity (design)

**Date:** 2026-06-20
**Branch:** `feat/app-tauri-wt`
**Surface:** `packages/app-tauri` — the ⌘O command palette
**Supersedes:** the *SearchPalette* portion of `2026-06-15-app-tauri-overlays-palettes-pickers-design.md` (which shipped the two-group cmdk palette). FindInPathModal / DirectoryPickerModal / ReviewPanel from that spec are unchanged.

---

## 1. Overview

The ⌘O palette in `app-tauri` is currently a two-group shadcn/cmdk `CommandDialog` (Sessions + Files). The warm-chrome artboard (`docs/design-reference/prototype/06-palette.jsx`) specifies a **Spotlight-style palette with four modes**, switched by the first character of the query:

| Prefix | Mode | Source |
|--------|------|--------|
| *(none)* | Files & Sessions | `searchFiles` + the aui thread list |
| `>` | Commands | a static in-app command registry |
| `@` | Symbols | LSP `workspace/symbol` |
| `#` | Changed files | `getGitStatus` (working tree) |

This spec rebuilds the palette to full artboard parity: the four modes, the artboard visual language, and the behavioral fixes found in the parity report. Sessions are **kept** (desktop behavior; useful) even though the literal artboard has no Sessions concept — they live in the default (no-prefix) mode.

### Goals
- Four working modes with artboard-accurate visuals and keyboard behavior.
- Fix the parity defects: duplicate close-X, missing `esc` chip, container radius/shadow/height-cap, row metrics, and the `shouldFilter` double-filter bug.
- Keep all data sources additive — **no daemon/core change**.

### Non-goals
- A "Recent files" MRU section (no MRU store exists; the artboard's recents are hardcoded demo data). Default empty state shows recent **Sessions** instead.
- Per-file `+N/−M` counts in `#` changes (the status endpoint has no counts; status badge only for v1).
- A general global-keybinding registry (out of scope; ⌘O wiring already exists).
- Multi-language symbol selection UI (v1 scopes `@` to one language — see §4.3).

---

## 2. Current state (what exists today)

- **Component:** `packages/app-tauri/src/components/overlays/SearchPalette.tsx` — `CommandDialog` with `Sessions` + `Files` groups. File rows via `useFileSearch` (`features/files/use-file-search.tsx`).
- **Open state:** `store/overlays.ts → paletteOpen`, set by the intent subscriber on `open-search-palette`.
- **Triggers:** ⌘O (`app/use-global-overlay-hotkeys.ts`) and `main-toolbar-search` (`layout/MainToolbar.tsx`), both emit `open-search-palette`.
- **Mount:** once in `AppShell`.
- **Known defects (parity report, 2026-06-20):**
  - Duplicate close-X from `DialogContent` (artboard has only an inline `esc` chip).
  - `shouldFilter` is documented as `false` but never set → cmdk's default `true` double-filters server file results and filters sessions on a synthetic `value` string.
  - Sessions render unfiltered and unbounded regardless of query (desktop filters by title + caps 5/10).
  - Container radius/shadow/border and height cap diverge; rows are not fixed-40px; no warm `accent` tint, MONO filenames, stacked sub-path, or ⏎-on-active.

### Confirmed infrastructure (drives the design)
- **LSP:** core `LspManager`/`LspRegistry`/`LspConnectionHandler`; a **transparent** WS↔process byte bridge (`lsp-proxy.ts → bridgeWsToProcess`) at `ws://host:port/lsp/<projectId>/<language>`. The app-tauri module singleton `lspClientManager` (exported from `@/lib/lsp`) already speaks JSON-RPC and is reused by the editor. Because the proxy forwards arbitrary methods, `workspace/symbol` requires **no core change** — only a new client method.
- **Git:** `getGitStatus(port, projectId, chatId?) → { path, status }[]` (`lib/api/git.ts`). No counts.
- **Commands:** all six artboard commands are reachable — `open-review` intent (exists), `useSettingsStore.open()`, `store/layout.ts` `toggleSidebar`/`toggleInspector`, `activate-surface` intent (exists). New intents added for the store-backed ones (see §4.2).
- **Diff:** `open-diff` intent exists and is consumed (`ChangesPanel.tsx`).
- **Language map:** `lib/lsp/language-detection.ts` (`.ts/.tsx/.js/.jsx → typescript`) + `getLspLanguage`.

---

## 3. Engine decision

**Drop cmdk; build a custom mode engine over the plain `Dialog` primitive + the existing `useListNavigation`** (chosen over keeping cmdk).

Rationale:
- cmdk's built-in filtering is the root of the `shouldFilter` defect and fights server-driven + heterogeneous multi-mode results.
- The artboard visuals (fixed-40px rows, mode chip, per-type trailing affordances, ⏎-on-active, flat cross-mode keyboard nav) are awkward through cmdk's item/value/selection slots.
- The artboard and the existing `FilePickerDialog` already use this custom pattern (`useListNavigation` + `FileRow`), so we reuse proven code.
- Using `Dialog` with `hideClose` removes the duplicate X **without** touching the shared `CommandDialog` (still used by `FindInPathModal`).

---

## 4. Design

### 4.1 Module layout

New feature dir `features/palette/` (feature-first; moves the component out of `components/overlays/`). Every file < 300 lines, every function < 50.

```
features/palette/
  SpotlightPalette.tsx        # shell: Dialog(hideClose) · field row · list · footer  (<150 lines)
  palette-modes.ts            # pure parseQuery(q) → { mode, term, chip, placeholder, sectionLabel }
  use-spotlight-results.ts    # per-mode fetch → SpotlightRow[]  (+ loading/empty flags)
  palette-commands.ts         # the command registry (id, label, icon, hint, run)
  SpotlightRow.tsx            # one row: icon col · title/sub · per-type trailing
  __tests__/                  # see §6
```

Shared/lifted:
- `useListNavigation` is lifted from `features/files/use-file-search.tsx` into a shared hook (e.g. `lib/ui/use-list-navigation.ts`) and imported by both the palette and `FilePickerDialog` (avoids a cross-feature import).

Backend touchpoints (all additive):
- `lib/lsp/lsp-client.ts` — add `getWorkspaceSymbols(projectId, language, query) → LspSymbol[]` to `LspProviders` + `LspClientManager`, and an `LspSymbol` type. Sends `workspace/symbol`; maps `SymbolInformation[]` → `{ name, kind, path (relative), line }`. Optionally declares the `workspace.symbol` client capability in `initialize`. Editor usage is unaffected.
- `store/surface-intents.ts` — add `open-settings`, `toggle-sidebar`, `toggle-inspector` to the `SurfaceIntent` union, with subscribers in `AppShell`/layout, so `>` commands dispatch via intents rather than `getState()` reach-through (honors "surface intent, not reach-through").

### 4.2 Mode engine

`parseQuery(q)` returns the active mode and the residual term:

| First char | mode | chip | placeholder | section label |
|-----------|------|------|-------------|---------------|
| `>` | `cmd` | "Commands" | "Run a command…" | "Commands" |
| `@` | `sym` | "Symbols" | "Go to symbol…" | "Symbols" |
| `#` | `chg` | "Changes" | "Filter changed files…" | "Working tree" |
| else | `file` | *(none)* | "Search files…  · type > commands  @ symbols  # changes" | "Files" / "Sessions" |

Keyboard (window-level, artboard parity): ↑/↓ move the flat active index across the combined list; ⏎ runs the active row; `esc` closes. The mode chip clears when the prefix is deleted.

### 4.3 Per-mode data sources

- **`file` (default):**
  - *Sessions* — from the aui thread list (`threadItemsToSessionItems`), filtered by title substring, capped ~5 (empty query) / ~10 (querying), matching desktop. **We own the filtering** (cmdk is gone), which fixes the double-filter bug.
  - *Files* — `searchFiles` via `useFileSearch` (≥2 chars, debounced, request-id guarded — reused as-is).
  - Empty state: recent Sessions + the hint placeholder. No "Recent files" section (no MRU source).
- **`cmd`:** static registry in `palette-commands.ts`, fuzzy-filtered by term:
  | id | label | hint | action |
  |----|-------|------|--------|
  | `review` | Review changes… | ⌘⇧R | `open-review` |
  | `settings` | Open Settings… | ⌘, | `open-settings` |
  | `sidebar` | Toggle Sidebar | ⌘\ | `toggle-sidebar` |
  | `inspector` | Toggle Inspector | | `toggle-inspector` |
  | `files` | Reveal Files surface | | `activate-surface: files` |
  | `run` | Reveal Run surface | | `activate-surface: run` |
- **`sym`:** on entering `@` mode, `lspClientManager.ensureClient(projectId, language, …)`; debounced `getWorkspaceSymbols(term)`. **Language = the active editor tab's language if present, else `typescript`** (v1). Rows show symbol name (title) + relative path (sub); select → `open-file` with `{ path, line }`. While the client initializes or the term is empty, show a quiet loading/empty state (no protocol error — the client returns `[]` until ready).
- **`chg`:** `getGitStatus(port, projectId, chatId)`, filtered by term; status badge (M/A/D/??/R) + path. Select → `open-diff { path }`.

### 4.4 Per-row actions
`session` → `runtime.threads.switchToThread` + `activate-surface: chat` · `file`/`sym` → `open-file` (sym carries `line`) · `chg` → `open-diff` · `cmd` → its `run()`.

### 4.5 Visual parity (artboard `06-palette.jsx`)
- **Container:** `Dialog`+`hideClose`; 580px / 11vh top; radius **13px**; **no border**; artboard shadow `0 32px 80px rgba(0,0,0,.34), 0 0 0 .5px rgba(0,0,0,.16)`; **max-height 62vh** on the dialog, the list flexes (replaces `CommandList max-h-80`).
- **Field row:** h54, padding `0 16px`, gap 11; search icon 16px `mf-text-3`; optional mode chip (accent tint bg, accent text, h22/px9/radius6, 11px/700); input 15px (`text-heading`); trailing **`esc` kbd** (the dup X is gone).
- **Rows:** fixed **h40**, gap 11, radius 8, active bg = warm `accent` tint (≈ `accent/8`, **not** the iOS-blue `mf-selection`); icon 15px (active `accent` else `mf-text-3`, or per-type color); title 13px (`text-body`), **MONO** for file/sym/chg, weight 600 active / 500; sub 11px `mf-text-3` stacked **below** title; per-type trailing — `cmd` shows hint kbds, `sym` shows a kind tag, `chg` shows a status badge, and active rows with no trailing show a ⏎ icon.
- **Section label:** 10px/700 uppercase `mf-text-3`.
- **Footer:** h34, `bg-mf-content2`, border-top, **gap 16px**, three kbd/label pairs (↑↓ Navigate · ⏎ Open · esc Dismiss) — already close; tighten the gap.
- **Tokens** (all verified registered in `styles/globals.css`): `popover`, `mf-content2`, `mf-chip`, `mf-text-3`, `accent`, `mf-scrim`.

### 4.6 data-testids
`search-palette` (root), `search-palette-input`, `search-palette-mode-chip`, `search-palette-session-row-{id}`, `search-palette-file-row-{path}`, `search-palette-command-row-{id}`, `search-palette-symbol-row-{path}:{line}`, `search-palette-change-row-{path}`, `search-palette-empty`, `search-palette-footer`. Loop rows key off a stable domain id, never an array index.

---

## 5. Data flow

⌘O / toolbar → `open-search-palette` → subscriber sets `overlays.paletteOpen` → `SpotlightPalette` renders → `parseQuery` picks the mode → `use-spotlight-results` fetches that mode's rows → `useListNavigation` drives the flat active index → ⏎/click runs the row's action (thread switch / `open-file` / `open-diff` / command intent) and closes.

---

## 6. Testing (TDD; run touched suites individually)

- **Unit — `palette-modes`:** `parseQuery` for `>`, `@`, `#`, plain, and empty; term stripping; chip/placeholder/sectionLabel.
- **Unit — `palette-commands`:** each command's `run()` emits the right intent (mock `emitSurfaceIntent` / settings store).
- **Unit — `use-spotlight-results`:** per mode, with mocked `searchFiles` / `getGitStatus` / `getWorkspaceSymbols` / thread items — asserts row shape, session title-filter + caps, and that file results are **not** re-filtered (regression for the `shouldFilter` bug).
- **Unit — `getWorkspaceSymbols`:** mock the WS `sendRequest`; assert `workspace/symbol` params and the `SymbolInformation → { name, kind, path, line }` mapping (hardcoded expected values, not recomputed).
- **Behavior — `SpotlightPalette`:** open/close; mode switch via prefix; one row select per type (asserting the action); flat keyboard nav (↑/↓/⏎/esc).

Verification: `pnpm --filter @qlan-ro/mainframe-app-tauri typecheck` (includes tests); each new suite run on its own (`React.act` cross-file pollution).

---

## 7. Side effects outside this surface (flagged)

- **New intents + subscribers** (`open-settings`, `toggle-sidebar`, `toggle-inspector`) in `surface-intents.ts` + `AppShell`/layout — additive; existing emitters unaffected.
- **`lib/lsp/lsp-client.ts`** gains `getWorkspaceSymbols` + `LspSymbol` — additive; the editor's definition/references/hover paths are untouched.
- **`useListNavigation` lifted** from `use-file-search` to a shared hook — `FilePickerDialog` import updated; behavior unchanged.
- **Mount path moves** — `components/overlays/SearchPalette.tsx` → `features/palette/SpotlightPalette.tsx`; update the `AppShell` import and the test path. The old `SearchPalette.test.tsx` is migrated/replaced.
- **Untouched:** `FindInPathModal`, `DirectoryPickerModal`, `ReviewPanel`, the shared `CommandDialog`, the daemon/core, the mobile contract.

---

## 8. Definition of done
Typecheck + targeted suites green · four modes working against real data · matches `06-palette.jsx` (design-conformance, px cross-checked for the compressed-spacing trap) · `shouldFilter`/session-scoping defects fixed · data-testids present · no `getState()` reach-through · files < 300 lines · cmdk dropped from this surface · MIGRATION-TRACKER updated.

---

## 9. Open items
None blocking. Minor, resolved-by-default:
- `@` language scoping is the active editor's language else `typescript` (v1). Multi-language enumeration via `/api/lsp/languages` is a future enhancement, not in scope.
- If `workspace/symbol` proves unsupported by the running server at build time, `@` degrades gracefully to an empty state (the client already returns `[]`); revisit the source only if that happens.

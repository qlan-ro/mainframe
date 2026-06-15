# Settings surface — app-tauri migration (design)

**Date:** 2026-06-15
**Branch:** `feat/app-tauri-wt`
**Tracker leaf:** `MIGRATION-TRACKER.md → Settings` (Recommended next steps step 9: Settings)
**Status:** design approved; spec for the `/do` pipeline (codex review → plan → thermo-nuclear review → impl → dual review).

## Goal

Port the desktop (Electron) **Settings** surface into `packages/app-tauri/src/features/settings/`, conforming to the warm-chrome artboard `docs/design-reference/prototype/05-settings.jsx` and the golden rule. This is a *port + refactor* of ~1,800 lines of reference code (one modal shell + 5 panes + store + 2 API clients), not a new feature.

Two scope decisions were taken in brainstorming:

1. **Full 3-axis Appearance UI** — the General pane exposes the existing 3-axis appearance system (Mode × Colour Scheme × Window Style), closing the deferred "Settings → Appearance UI" tracker item.
2. **Include the composer provider-defaults wiring** — once the provider-defaults API client exists, thread it into the composer's `EffortPicker`/`FeaturesPopover`/`use-composer-tuning`, which currently pass `undefined`.

## Canonical scope (tracker §Settings, verbatim)

- **S1** `replace` SettingsModal shell (chrome/sidebar/routing on shadcn Dialog)
- **S2** `refactor` settings store · Provider(+TuningDefaults/CodexTuning/ModelDropdown) · General/Notifications/About/Sidebar · RemoteAccess (decompose the 697-line god-file)
- **S3** `port` settings-api + remote-access-api
- **S4** `drop` Keybindings placeholder pane

## What already exists (de-risking)

- **All needed shadcn primitives are present** in `components/ui/`: `dialog`, `select`, `dropdown-menu`, `switch`, `checkbox`, `label`, `input`, `popover`, `tooltip`, `radio-group`, `scroll-area`, `separator`. The tracker's "missing primitives" note is **stale** — no primitive-building prerequisite.
- **`getAppInfo()` Tauri bridge exists** (`lib/tauri/bridge.ts:48`), returning `{ version, author, homedir }`. The About pane's only Electron dependency is already solved. **No updater exists** (`get_app_info` has no update channel; the §9 Update pill is deferred).
- **`useTheme` store exists** (`store/theme.ts`): `mode: 'light'|'dark'` + `setMode`/`toggle`; `scheme: 'classic'|'ocean'|'velvet'` + `setScheme`; `windowStyle: 'unified'|'split'|'glass'` + `setWindowStyle`. Persists to `localStorage`; `applyStoredTheme()` is the FOUC guard. The appearance system is **store-only with no Settings UI** today.
- **`SidebarHeader` `SettingsBtn`** exists but is a **stub with no `onClick`** (`data-testid="sidebar-settings-button"`, advertises `⌘,`). It must be wired to open the dialog.
- **`lib/api/`** already has `adapters`, `chats`, `projects`, `git`, `files`, `tags`, `http`, etc. **Missing:** `settings.ts` and `remote-access.ts` — genuine new client work (S3). The daemon REST routes themselves are shared with desktop and **unchanged**.
- **`features/chat/composer/config-toolbar/`** holds the wiring targets: `EffortPicker.tsx`, `FeaturesPopover.tsx`, `use-composer-tuning.ts`, plus `ProviderModelSelect.tsx` (reusable model-list logic).

## Architecture

### Mount & trigger

- One `<SettingsDialog/>` mounted **once at the App root** (the realized pattern — cf. `ArchiveWorktreeDialog`/`TagPopoverHost` mounted once at root, not inside a feature subtree). No feature imports `layout/`.
- A new **`store/settings.ts`** (zustand) owns dialog state. `SidebarHeader.SettingsBtn` `onClick` → `useSettings.getState().open()` via the store hook (no `getState()` reach-through in render — call the action from the handler). Add a `⌘,` global shortcut that calls `open()`.

### Shell (S1)

- `features/settings/SettingsDialog.tsx` — shadcn `Dialog` (`components/ui/dialog`), sized to the artboard (≈760×600, `max-w`/`max-h` responsive). Root element carries `data-testid="settings-dialog"`.
- `features/settings/SettingsSidebar.tsx` — the left nav; renders `SettingsNavItem` rows from a local `SETTINGS_TABS` array `{ id, label, icon }`. Tab ids: `general` · `providers` · `notifications` · `remote-access` · `about` (**no `keybindings`** — S4). Active tab from the store. Each row `data-testid={`settings-nav-${id}`}`.
- `features/settings/SettingsContent.tsx` — routes `activeTab` → pane. A plain switch; lazy-load is unnecessary (panes are light) **except** RemoteAccess if it pulls weight — default to eager, revisit only if bundle flags it.

### Panes (S2)

Folder-per-pane under `features/settings/panes/`:

- **`general/GeneralPane.tsx`**
  - Worktree-dir **text input** → `updateGeneralSettings({ worktreeDir })` (seeded from the store; dirty-tracked like desktop).
  - **Appearance section** (Decision 1): three control groups bound to `useTheme` —
    - Mode: light/dark segmented toggle → `setMode` (no `system` — the store has no such value).
    - Colour Scheme: classic/ocean/velvet picker → `setScheme`.
    - Window Style: unified/split/glass picker → `setWindowStyle`.
  - Appearance is a **client/localStorage** preference — **no API call**, no settings-store entry; it reads/writes `useTheme` directly. Conform the control styling to the artboard's theme-picker slot, extended to three axes.
- **`providers/ProvidersPane.tsx`** + sub-nav
  - Provider switcher (adapters from `lib/api/adapters`); `selectedProvider` in the settings store.
  - Per-provider config: executable path (**plain text input** — native dir-picker deferred), AskUserQuestion + PlanMode toggles (shadcn `Switch`/`Checkbox`), Default Model dropdown (shadcn `Select`/`DropdownMenu`; reuse model-list helpers from `ProviderModelSelect` where clean rather than re-deriving), `ProviderTuningDefaults` (effort `Select` + feature `Switch`es, **model-gated**), `CodexTuningDefaults` (personality + reasoning-summary, **Codex only**), Default Session Mode `radio-group`.
  - Conflicts warning via `getConfigConflicts(adapterId)`.
  - Decompose so no file exceeds 300 lines: `ProvidersPane` (switcher + layout), `ProviderConfigForm`, `ProviderTuningDefaults`, `CodexTuningDefaults`, `ModelDropdown` as siblings.
- **`notifications/NotificationsPane.tsx`**
  - Toggle groups (chat / permission / other) via shadcn `Switch`. Extract a shared **`ToggleRow`** + **`SettingGroup`** (desktop inlines these — do not).
  - Writes via **deep-partial** `updateGeneralSettings({ notifications: patch })` to avoid clobbering concurrent writes (parity with desktop).
- **`remote-access/`** — the decomposed god-file, split along **tunnel / pairing / devices**:
  - `use-tunnel-status.ts` — the state-machine hook. REST snapshot (`getTunnelStatus`) + WS `tunnel:status` subscription (via the app-tauri daemon event client) → `TunnelUiState = 'idle'|'starting'|'verifying'|'ready'|'unreachable'|'error'`; exposes `start/stop/retryVerify/running/verified/url/errorMsg/loading/togglingAction`. **Highest-value test target.**
  - `RemoteAccessPane.tsx` — top wrapper (loading + heading).
  - `TunnelControl.tsx` — loads tunnel config (named vs quick), composes sections (Named always; Quick only when no named config; Pairing only when `verified`; Devices always).
  - `NamedTunnelSection.tsx` · `QuickTunnelSection.tsx` · `TunnelStatusRow.tsx` (shared status pill).
  - `PairingSection.tsx` — pairing code generate + expiry countdown (own interval/cleanup).
  - `DevicesSection.tsx` — paired devices list + remove.
  - `CopyButton.tsx` — shared copy-to-clipboard (local to remote-access; promote to `ui/` only if a second consumer appears).
  - Preserve all desktop `data-testid`s (`named-tunnel-toggle`, `quick-tunnel-toggle`, `pairing-generate-code`, `remote-access-device-remove-${id}`, etc.).
- **`about/AboutPane.tsx`** — version/author/homedir from `getAppInfo()`. **Omit** "Check for updates"/"Release notes" (no updater). Keep it a thin read-only pane.

### Store & data (S2 + S3)

- **`store/settings.ts`** (zustand): `isOpen`, `activeTab`, `selectedProvider`, `providers: Record<string, ProviderConfig>`, `general: GeneralConfig`, `loading`. Actions: `open(provider?, tab?)`, `close()`, `setActiveTab`, `setSelectedProvider`, `loadProviders`, `loadGeneral`, `setProviderConfig`, `setNotifications`, `setLoading`. **Seed from REST on open; PUT on change; optimistic-local** (mirrors desktop; standalone modal, not the chat controller). Appearance is **not** in this store.
- **`lib/api/settings.ts`** (S3) — `getProviderSettings` (`GET /settings/providers`), `updateProviderSettings(adapterId, patch)` (`PUT /settings/providers/:id`), `getGeneralSettings` (`GET /settings/general`), `updateGeneralSettings(patch)` (`PUT /settings/general`), `getConfigConflicts(adapterId)` (`GET /adapters/:id/config-conflicts`). Use the existing `http.ts` helper + WS4 response envelope conventions; Zod-validate where the app-tauri api layer does.
- **`lib/api/remote-access.ts`** (S3) — `getTunnelStatus`, `startTunnel`, `stopTunnel`, `getTunnelConfig` (`/tunnel/*`), `generatePairingCode`, `getDevices`, `removeDevice` (`/auth/*`). Same shared daemon routes; **no contract change**.

### Composer wiring (Decision 2)

After the provider-defaults client + store land, fetch provider tuning-defaults (the `getProviderSettings` data) and thread them as the currently-`undefined` 3rd arg into `EffortPicker.tsx`/`FeaturesPopover.tsx`/`use-composer-tuning.ts` so effort/feature constraints inherit provider defaults. Keep this a **separable final task** in the plan — it touches the composer, not the settings feature — so it can be reviewed independently and dropped without blocking the Settings surface.

## Error handling & logging

- API clients surface failures through the existing `http.ts` error path; callers log with context (no silent catches; desktop uses `createLogger('renderer:remote-access')` — app-tauri uses its equivalent console-tagged warn).
- The tunnel hook keeps the desktop's defensive pattern: `refresh()` after `start()` to converge if a WS broadcast was missed; warn-and-continue on status/config/devices fetch failures.

## Testing

- **`use-tunnel-status` hook** — state-machine transitions across all six states + WS events + start/stop/retry (primary target).
- **`store/settings.ts`** — open/close, tab/provider selection, load + optimistic patch, deep-partial notifications.
- **`lib/api/settings.ts` + `lib/api/remote-access.ts`** — endpoint/method/shape per function (mock `http`).
- **Panes** — render + interaction smoke tests bound to `data-testid`s; design-conformance vs `05-settings.jsx`.
- Composer wiring — extend existing `use-composer-tuning` / `EffortPicker` / `FeaturesPopover` tests for provider-default inheritance.

## Definition of done (per app-tauri DoD)

Typecheck + tests green · matches `05-settings.jsx` (design-conformance) · thermo-nuclear standards · `settings-<element>` data-testids on every interactive element · no `getState()` reach-through in render · all files <300 lines / functions <50 · Keybindings dropped · `MIGRATION-TRACKER.md §Settings` updated · changeset added.

## Out of scope / deferred (logged, not built)

- Native Tauri directory-picker for the executable path (`@tauri-apps/plugin-dialog` + capability) — text input for v1.
- The Tauri updater, the About "check for updates"/"release notes" controls, and the §9 sidebar Update pill.
- The standalone `DirectoryPickerModal` overlay (separate overlays leaf).
- `system` theme mode (the `useTheme` store models only light/dark).

## Risks

- **Shared worktree** — a concurrent session commits to `feat/app-tauri-wt`. Stage only Settings files by explicit path; implementers run **sequentially** (parallel agents collide on the git index + build locks).
- **Daemon route assumptions** — the design assumes the `/settings/*`, `/tunnel/*`, `/auth/*` routes serve the same shapes app-tauri expects; verify against `packages/core` during implementation (additive only; mobile co-owns the contract).
- **Composer wiring blast radius** — Decision 2 touches chat composer files; isolate it as the last task so a regression there can't block the Settings surface review.

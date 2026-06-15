# Settings surface — app-tauri migration (design)

**Date:** 2026-06-15
**Branch:** `feat/app-tauri-wt`
**Tracker leaf:** `MIGRATION-TRACKER.md → Settings` (Recommended next steps step 9: Settings)
**Status:** design approved; spec for the `/do` pipeline (codex review → plan → thermo-nuclear review → impl → dual review).

## Goal

Port the desktop (Electron) **Settings** surface into `packages/app-tauri/src/features/settings/`, conforming to the warm-chrome artboard `docs/design-reference/prototype/05-settings.jsx` and the golden rule. This is a *port + refactor* of ~1,800 lines of reference code (one modal shell + 5 panes + store + 2 API clients), not a new feature.

Two scope decisions were taken in brainstorming:

1. **Full 3-axis Appearance UI** — the General pane exposes the existing 3-axis appearance system (Mode × Colour Scheme × Window Style), closing the deferred "Settings → Appearance UI" tracker item.
2. **Include the composer provider-defaults wiring** — once the provider-defaults API client exists, thread them into the composer's `EffortPicker.tsx`/`FeaturesPopover.tsx`/`use-composer-tuning.ts` so effort/feature constraints inherit provider defaults. Keep this a **separable final task** in the plan — it touches the composer, not the settings feature — so it can be reviewed independently and dropped without blocking the Settings surface.

## Canonical scope (tracker §Settings, verbatim)

- **S1** `replace` SettingsModal shell (chrome/sidebar/routing on shadcn Dialog)
- **S2** `refactor` settings store · Provider(+TuningDefaults/CodexTuning/ModelDropdown) · General/Notifications/About/Sidebar · RemoteAccess (decompose the 697-line god-file)
- **S3** `port` settings-api + remote-access-api
- **S4** `drop` Keybindings placeholder pane

## What already exists (de-risking)

- **All needed shadcn primitives are present** in `components/ui/`: `dialog`, `select`, `dropdown-menu`, `switch`, `checkbox`, `label`, `input`, `popover`, `tooltip`, `radio-group`, `scroll-area`, `separator`. The tracker's "missing primitives" note is **stale** — no primitive-building prerequisite.
- **`getAppInfo()` Tauri bridge exists** (`lib/tauri/bridge.ts:48`), returning `{ version, author, homedir }`. The About pane's only Electron dependency is already solved. **No updater exists** (`get_app_info` has no update channel; the §9 Update pill is deferred).
- **`useTheme` store exists** (`store/theme.ts`): `mode: 'light'|'dark'` + `setMode`/`toggle`; `scheme: 'classic'|'ocean'|'velvet'` + `setScheme`; `windowStyle: 'unified'|'split'|'glass'` + `setWindowStyle`. Persists to `localStorage`; `applyStoredTheme()` is the FOUC guard. The appearance system is **store-only with no Settings UI** today.
- **`SidebarHeader` `SettingsBtn`** exists at `packages/app-tauri/src/layout/SidebarHeader.tsx` but is a **stub with no `onClick`** (`data-testid="sidebar-settings-button"`, advertises `⌘,`). It must be wired to open the dialog.
- **`lib/api/`** already has `adapters`, `chats`, `projects`, `git`, `files`, `tags`, `http`, etc. **Missing:** `settings.ts` and `remote-access.ts` — genuine new client work (S3). The daemon REST routes themselves are shared with desktop and **unchanged**.
- **`features/chat/composer/config-toolbar/`** holds the wiring targets: `EffortPicker.tsx`, `FeaturesPopover.tsx`, `use-composer-tuning.ts`, plus `ProviderModelSelect.tsx` (reusable model-list logic). Both `EffortPicker` and `FeaturesPopover` already pass `undefined` as a placeholder for the provider-defaults arg (see `EffortPicker.tsx:43` `displayEffort(chat, model, undefined)` and `FeaturesPopover.tsx:104` `effectiveFeature(chat, undefined, f.key)`); the wiring task replaces those `undefined` literals with the fetched `ProviderConfig`.

## Architecture

### Mount & trigger

- One `<SettingsDialog port={port}/>` mounted **once in `RuntimeBody`** (`packages/app-tauri/src/app/AppShell.tsx`) alongside the existing app-wide outlets (`ArchiveWorktreeDialog`, `FilePickerDialog`, `TagPopoverHost`). No feature imports `layout/`. The `port` prop follows the same pattern as `<TagPopoverHost port={port}/>`.
- A new **`store/settings.ts`** (zustand) owns dialog state. `SidebarHeader.SettingsBtn` `onClick` → `useSettings.getState().open()` via the store hook (no `getState()` reach-through in render — call the action from the handler). Add a `⌘,` global shortcut that calls `open()`.

### Shell (S1)

- `features/settings/SettingsDialog.tsx` — shadcn `Dialog` (`components/ui/dialog`), sized to the artboard (≈760×600, `max-w`/`max-h` responsive). Root element carries `data-testid="settings-dialog"`.
- `features/settings/SettingsSidebar.tsx` — the left nav; renders `SettingsNavItem` rows from a local `SETTINGS_TABS` array `{ id, label, icon }`. Tab ids: `general` · `providers` · `notifications` · `remote-access` · `about` (**no `keybindings`** — S4). Active tab from the store. Each row `data-testid={`settings-nav-${id}`}`.
- `features/settings/SettingsContent.tsx` — routes `activeTab` → pane. A plain switch; lazy-load is unnecessary (panes are light) **except** RemoteAccess if it pulls weight — default to eager, revisit only if bundle flags it.

### Panes (S2)

Folder-per-pane under `features/settings/panes/`:

- **`general/GeneralPane.tsx`**
  - Worktree-dir **text input** — dirty-tracked with an explicit Save button; commits only after the daemon round-trip succeeds (same as desktop, NOT on-change — see Write policy below). Shows a visible error if the save fails.
  - **Appearance section** (Decision 1): three control groups bound to `useTheme` —
    - Mode: light/dark segmented toggle → `setMode` (no `system` — the store has no such value).
    - Colour Scheme: classic/ocean/velvet picker → `setScheme`.
    - Window Style: unified/split/glass picker → `setWindowStyle`.
  - Appearance is a **client/localStorage** preference — **no API call**, no settings-store entry; it reads/writes `useTheme` directly. Conform the control styling to the artboard's theme-picker slot, extended to three axes.
- **`providers/ProvidersPane.tsx`** + sub-nav
  - Provider switcher (adapters from `lib/api/adapters`); `selectedProvider` in the settings store.
  - Per-provider config: executable path (**plain text input** — native dir-picker deferred), AskUserQuestion + PlanMode toggles (shadcn `Switch`/`Checkbox`), Default Model dropdown (shadcn `Select`/`DropdownMenu`; reuse model-list helpers from `ProviderModelSelect` where clean rather than re-deriving), `ProviderTuningDefaults` (effort `Select` + feature `Switch`es, **model-gated**), `CodexTuningDefaults` (personality + reasoning-summary, **Codex only**), Default Session Mode `radio-group`.
  - Conflicts warning via `getConfigConflicts(port, adapterId)`.
  - Decompose so no file exceeds 300 lines: `ProvidersPane` (switcher + layout), `ProviderConfigForm`, `ProviderTuningDefaults`, `CodexTuningDefaults`, `ModelDropdown` as siblings.
- **`notifications/NotificationsPane.tsx`**
  - Toggle groups (chat / permission / other) via shadcn `Switch`. Extract a shared **`ToggleRow`** + **`SettingGroup`** (desktop inlines these — do not).
  - Writes via **deep-partial** `updateGeneralSettings(port, { notifications: patch })` to avoid clobbering concurrent writes (parity with desktop).
- **`remote-access/`** — the decomposed god-file, split along **tunnel / pairing / devices**:
  - `use-tunnel-status.ts` — the state-machine hook. REST snapshot (`getTunnelStatus(port)`) + WS `tunnel:status` subscription (via `daemonWs.onEvent` — the singleton at `lib/daemon/ws-client.ts`) → `TunnelUiState = 'idle'|'starting'|'verifying'|'ready'|'unreachable'|'error'`; exposes `start/stop/retryVerify/running/verified/url/errorMsg/loading/togglingAction`. **Highest-value test target.**
  - `RemoteAccessPane.tsx` — top wrapper (loading + heading).
  - `TunnelControl.tsx` — loads tunnel config (named vs quick), composes sections (Named always; Quick only when no named config; Pairing only when `verified`; Devices always).
  - `NamedTunnelSection.tsx` · `QuickTunnelSection.tsx` · `TunnelStatusRow.tsx` (shared status pill).
  - `PairingSection.tsx` — pairing code generate + expiry countdown (own interval/cleanup).
  - `DevicesSection.tsx` — paired devices list + remove.
  - `CopyButton.tsx` — shared copy-to-clipboard (local to remote-access; promote to `ui/` only if a second consumer appears).
  - Preserve all desktop `data-testid`s on remote-access interactive elements (`named-tunnel-toggle`, `quick-tunnel-toggle`, `pairing-generate-code`, `remote-access-device-remove-${id}`, etc.) — these are domain-scoped already and do not need the `settings-` prefix. All other new interactive elements (nav items, dialog close, General/Providers/Notifications/About controls) follow the `settings-<element>` naming convention per the DoD.
- **`about/AboutPane.tsx`** — version/author/homedir from `getAppInfo()`. **Omit** "Check for updates"/"Release notes" (no updater). Keep it a thin read-only pane.

### Store & data (S2 + S3)

- **`store/settings.ts`** (zustand): `isOpen`, `activeTab`, `selectedProvider`, `providers: Record<string, ProviderConfig>`, `general: GeneralConfig`, `loading`. Actions: `open(provider?, tab?)`, `close()`, `setActiveTab`, `setSelectedProvider`, `loadProviders`, `loadGeneral`, `setProviderConfig`, `setNotifications`, `setLoading`. **Seed from REST on open; PUT on change (except `worktreeDir` — see Write policy); optimistic-local** (mirrors desktop; standalone modal, not the chat controller). Appearance is **not** in this store.

#### Write policy by pane

| Pane / field | Policy |
|---|---|
| Provider config, tuning defaults | Optimistic-local: update store → PUT; log failure with `console.warn` |
| Notifications toggles | Optimistic-local: deep-partial PUT; log failure |
| General `worktreeDir` | Explicit save: dirty-tracked text input + Save button; PUT on click; rollback + show error on failure |
| Appearance (mode/scheme/windowStyle) | Client-only: `useTheme` write + `localStorage`; no PUT |

- **`lib/api/settings.ts`** (S3) — all functions take `port: number` as first argument (matching the app-tauri client convention in `lib/api/http.ts`):
  - `getProviderSettings(port)` → `GET /api/settings/providers`
  - `updateProviderSettings(port, adapterId, patch)` → `PUT /api/settings/providers/:id`
  - `getGeneralSettings(port)` → `GET /api/settings/general`
  - `updateGeneralSettings(port, patch)` → `PUT /api/settings/general`
  - `getConfigConflicts(port, adapterId)` → `GET /api/adapters/:id/config-conflicts`
  - Use `request<T>` / `requestEmpty` from `http.ts` with `${apiBase(port)}/api/...`. Zod-validate response shapes.
- **`lib/api/remote-access.ts`** (S3) — all functions take `port: number` as first argument:
  - `getTunnelStatus(port)` → `GET /api/tunnel/status`
  - `startTunnel(port, config?)` → `POST /api/tunnel/start`
  - `stopTunnel(port, opts?)` → `POST /api/tunnel/stop`
  - `getTunnelConfig(port)` → `GET /api/tunnel/config`
  - `generatePairingCode(port)` → `POST /api/auth/pair`
  - `getDevices(port)` → `GET /api/auth/devices`
  - `removeDevice(port, deviceId)` → `DELETE /api/auth/devices/:deviceId` — the daemon returns `{ success: true }` (a JSON envelope, not HTTP 204); use `requestEmpty`, not `requestNoContent`.
  - Same shared daemon routes; **no contract change**.

### Composer wiring (Decision 2)

The composer is used in every chat session, so provider defaults must be available independent of whether the user has ever opened Settings. The load path is:

1. **Prefetch on mount in `RuntimeBody`**: call `useSettingsStore.getState().loadProviders(await getProviderSettings(port))` once in a `useEffect` that fires when `port` is known (alongside the existing `daemonWs.setPort(port)` call in `App.tsx`, or equivalently in a `useEffect` in `RuntimeBody`). Guard with `Object.keys(providers).length === 0 && !loading` to avoid redundant fetches. Log and swallow errors — `providers` stays empty, which keeps the current `undefined` fallback safe for the composer.

2. **Reactive read in `use-composer-tuning.ts`**: read provider config via the zustand selector form — `const providerDefaults = useSettingsStore((s) => adapter ? s.providers[adapter.id] : undefined)` — **not** `getState()`, which is non-reactive and would not re-render when the async prefetch resolves. This is consistent with the DoD "no `getState()` reach-through in render" rule.

3. **Replace the placeholder `undefined`s**: `displayEffort(chat, model, undefined)` at `EffortPicker.tsx:43` and `effectiveFeature(chat, undefined, f.key)` at `FeaturesPopover.tsx:104` — replace both `undefined` args with the reactive `providerDefaults` value. Treat `undefined` (not-yet-loaded or unavailable) identically to the current behavior — controls resolve constraints without provider inheritance, which is safe.

4. **Draft mode**: draft chats have no daemon-issued `adapterId`; read `draftConfig.adapterId` from the draft store to key into `providers`.

5. **Settings dialog re-loads** on open (existing design — `loadProviders` + `loadGeneral` fire in the `useEffect([isOpen])`), which keeps the Settings pane fresh and acts as a natural refresh path after the user changes provider config from another device.

Keep this a **separable final task** in the plan — it touches the composer, not the settings feature — so it can be reviewed independently and dropped without blocking the Settings surface review.

## Error handling & logging

- API clients surface failures through the existing `http.ts` error path; callers log with context (no silent catches; app-tauri renderer uses `console.warn` with a module tag, e.g. `console.warn('[settings/GeneralPane]', err)`).
- The tunnel hook keeps the desktop's defensive pattern: `refresh()` after `start()` to converge if a WS broadcast was missed; warn-and-continue on status/config/devices fetch failures.
- The prefetch action (`RuntimeBody` → `loadProviders`) logs and swallows errors — `providers` stays empty, which is the existing `undefined` fallback, safe for the composer.

## Testing

- **`use-tunnel-status` hook** — state-machine transitions across all six states + WS events + start/stop/retry (primary target).
- **`store/settings.ts`** — open/close, tab/provider selection, load + optimistic patch, deep-partial notifications, prefetch dedup guard + error swallow.
- **`lib/api/settings.ts` + `lib/api/remote-access.ts`** — endpoint/method/shape per function (mock `http`).
- **Panes** — render + interaction smoke tests bound to `data-testid`s; design-conformance vs `05-settings.jsx`.
- Composer wiring — extend existing `use-composer-tuning` / `EffortPicker` / `FeaturesPopover` tests for provider-default inheritance; verify that the `useSettingsStore` selector re-renders the toolbar when `providers` populates asynchronously; verify fallback when `providers` is empty.

## Definition of done (per app-tauri DoD)

Typecheck + tests green · matches `05-settings.jsx` (design-conformance) · thermo-nuclear standards · `settings-<element>` data-testids on every interactive element (remote-access elements keep their domain-scoped desktop IDs) · no `getState()` reach-through in render · all files <300 lines / functions <50 · Keybindings dropped · `MIGRATION-TRACKER.md §Settings` updated · changeset added.

## Out of scope / deferred (logged, not built)

- Native Tauri directory-picker for the executable path (`@tauri-apps/plugin-dialog` + capability) — text input for v1.
- The Tauri updater, the About "check for updates"/"release notes" controls, and the §9 sidebar Update pill.
- The standalone `DirectoryPickerModal` overlay (separate overlays leaf).
- `system` theme mode (the `useTheme` store models only light/dark).

## Risks

- **Shared worktree** — a concurrent session commits to `feat/app-tauri-wt`. Stage only Settings files by explicit path; implementers run **sequentially** (parallel agents collide on the git index + build locks).
- **Daemon route assumptions** — the design assumes the `/api/settings/*`, `/api/tunnel/*`, `/api/auth/*` routes serve the same shapes app-tauri expects; verify against `packages/core` during implementation (additive only; mobile co-owns the contract).
- **Composer wiring blast radius** — Decision 2 touches chat composer files; isolate it as the last task so a regression there can't block the Settings surface review.

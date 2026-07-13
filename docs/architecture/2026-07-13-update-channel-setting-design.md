# Update channel setting (stable / pre-release)

## Problem

Both desktop shells (Electron, Tauri) have working auto-update pipelines, but neither can ever offer a pre-release (rc) build: Electron's `autoUpdater.allowPrerelease` defaults to `false`, and Tauri's updater endpoint is a static URL pointing at GitHub's `/releases/latest`, which excludes prereleases entirely. There is no user-facing way to opt into rc builds.

## Goal

Add a per-machine "update channel" preference (`stable` / `prerelease`) that a user can toggle in Settings, and wire both shells' update-check logic to respect it.

## Out of scope

- Fixing the CI release workflow leaving rc releases as unpublished drafts (`.github/workflows/release.yml`, `draft: true` with no publish step). The channel setting is inert until releases are published, by whatever means; that's separate, existing work.
- Any change to `release.yml` release/tag strategy.

## Data model

`packages/types/src/settings.ts`:

```ts
export const UPDATE_CHANNELS = ['stable', 'prerelease'] as const;
export type UpdateChannel = (typeof UPDATE_CHANNELS)[number];

export interface GeneralConfig {
  worktreeDir: string;
  notifications: NotificationConfig;
  updateChannel: UpdateChannel;
}

export const GENERAL_DEFAULTS: GeneralConfig = {
  worktreeDir: '.worktrees',
  notifications: NOTIFICATION_DEFAULTS,
  updateChannel: 'stable',
};
```

Default is always `'stable'`, even if the currently-installed build is itself an rc — no auto-detection, explicit opt-in only.

## Daemon

No new endpoint. `updateChannel` is a scalar field in the existing `general` settings category, handled by the existing generic loop in `packages/core/src/server/routes/settings.ts` (`PUT /api/settings/general`). Only change: add `updateChannel: z.enum(UPDATE_CHANNELS).optional()` to `UpdateGeneralSettingsBody` in `packages/core/src/server/routes/schemas.ts`. `GET /api/settings/general` already spreads `GENERAL_DEFAULTS` first, so existing rows read back as `'stable'`.

## UI

`packages/ui/src/features/settings/panes/general/GeneralPane.tsx` gains an "Updates" section, using the same `PickerRow` component `AppearanceControls.tsx` already uses for Mode/Color Scheme/Window Style — a two-option instant-save row: "Stable" / "Pre-release (RC)". Saved via the existing `updateGeneralSettings(port, { updateChannel })` call, same pattern as other scalar fields. No separate Save button (matches the instant-save picker convention, unlike the free-text worktree-dir field).

## Electron (`packages/app-electron/src/main/auto-updater.ts`)

Precedent: `idle-reporter.ts` already calls the daemon directly from the main process (`fetch(`${DAEMON_URL}/api/device/activity`)`).

- `initAutoUpdater` takes the daemon port (same as `DaemonStatusTracker` in `index.ts:255`).
- Before every check — both scheduled timers in `scheduleChecks()` and `checkForUpdatesManual()` — fetch `GET /api/settings/general` from the daemon, read `updateChannel`, and set `autoUpdater.allowPrerelease = updateChannel === 'prerelease'` immediately before calling `checkForUpdates()`.
- If the fetch fails (daemon briefly unreachable), default to `allowPrerelease = false` (stable) rather than blocking the check.
- No other changes — electron-updater's GitHub provider already lists releases and filters by `allowPrerelease` internally once that flag is set.

## Tauri (`packages/app-tauri/src-tauri/src/updater.rs`)

Precedent: `presence.rs` already POSTs to the daemon from Rust via `ureq`.

- Add `resolve_channel(daemon_port: u16) -> UpdateChannel`: `ureq` GET `/api/settings/general`, parse `updateChannel`, default to `Stable` on any error (offline daemon, malformed response, etc).
- **Stable path is unchanged**: `app.updater()` keeps using the static endpoint from `tauri.conf.json` (already correct for stable once a release is published).
- **Prerelease path only**: add `resolve_prerelease_endpoint() -> Option<Url>` — `ureq` GET `https://api.github.com/repos/qlan-ro/mainframe/releases` (unauthenticated, newest-first), skip entries with `draft: true`, take the first remaining entry regardless of its `prerelease` flag, and read its `latest.json` asset's `browser_download_url`. Build the updater via `app.updater_builder().endpoints(vec![url]).build()` instead of `app.updater()`.
- If the GitHub lookup fails (offline, rate-limited, no matching asset), fall back to the static default endpoint so a check never hard-fails — it just behaves like the stable channel for that attempt.
- Applies to `updater_check`, `updater_download`, `updater_install`, and `schedule_update_checks` — all resolve the channel/endpoint the same way before calling into the updater.

## Testing

- `GENERAL_DEFAULTS`/zod schema: new field defaults and validates correctly.
- `GeneralPane` test: selecting "Pre-release" fires `PATCH` with `updateChannel: 'prerelease'`; selecting "Stable" fires it with `'stable'`.
- Electron: unit test around the allowPrerelease-selection logic (given a fetched channel, is the flag set correctly), and the fetch-failure fallback to `false`.
- Tauri: unit test for the release-filtering logic (skip drafts, take newest regardless of prerelease flag) against a fixture JSON array, mirroring how `error_classifier.rs` is tested today — same style as existing Rust unit tests in this file's neighborhood.

## Risks / notes

- Until the separate CI draft-publish gap is fixed, toggling to "Pre-release" has no visible effect (nothing published to fetch). This is expected and was explicitly descoped.
- The Tauri prerelease path adds an unauthenticated call to the public GitHub API on every prerelease-channel check (10s startup + every 4h) — low volume, well under GitHub's unauthenticated rate limit for a single-repo, single-user query.

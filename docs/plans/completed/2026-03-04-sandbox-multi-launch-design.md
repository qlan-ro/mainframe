# Sandbox Multi-Launch Pages

## Problem

The mobile sandbox screen assumes a single WebView driven by a tunnel URL. Launch configurations without `preview: true` have no useful UI — the screen shows "Waiting for tunnel URL" forever. Users must also start the preview config last, because the screen grabs the first tunnel URL it finds regardless of which config produced it.

## Goal

One swipeable page per launch configuration. Preview configs show a WebView; non-preview configs show fullscreen console logs. Each page controls its own process lifecycle.

## Architecture

### PagerView

Use `react-native-pager-view` for native horizontal swipe between pages. One page per `LaunchConfiguration`. Order: preview configs first, then non-preview.

### Page Types

**Preview page** (`preview: true`):
- WebView loads the config's tunnel URL
- Existing behavior preserved: loading spinner while waiting, auto-retry on HTTP 5xx, manual retry button
- ConsoleSheet available via floating button to inspect logs without leaving the WebView
- Fullscreen mode preserved

**Console page** (`preview: false` or unset):
- Fullscreen monospace log output, auto-scrolling
- Reuses existing `ConsoleSheet` log rendering (colors, font, layout) but as page content instead of a bottom sheet
- When stopped: centered empty state with play button
- When running: streaming log lines

### Header

All pages share a unified header:

- **Left**: Back button
- **Center**: Active config name (bold). Dot indicators below — one per page, active dot highlighted. Preview pages show the truncated tunnel URL as a subtitle. Console pages show a status pill ("running" green / "stopped" gray / "failed" red).
- **Right**: Process controls for all pages:
  - Stopped/failed → Play button
  - Starting → Spinner (disabled)
  - Running → Restart + Stop buttons
  - Preview pages additionally show Refresh and Fullscreen

### Removed Components

- **LaunchConfigSheet**: Each page has its own start/stop controls — no need for a separate sheet to manage configs.
- **SandboxTabBar**: The "Run" and "Console" floating buttons are replaced by per-page controls and the swipe navigation.
- **ConsoleSheet on console pages**: The page itself is the console. ConsoleSheet remains available on preview pages only.

## Data Changes

### API

`getLaunchConfigs` currently strips everything except `name` and a derived `command` string. It must also return the `preview` field so the UI can determine page type.

### Store

No changes. Logs and process statuses are already keyed by `${projectId}:${name}`.

### Tunnel URL Lookup

Currently grabs the first tunnel URL found for the project. Changes to look up the tunnel URL for the specific config name shown on the active preview page.

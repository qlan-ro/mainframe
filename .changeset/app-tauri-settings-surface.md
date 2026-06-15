---
"@qlan-ro/mainframe-app-tauri": minor
---

Add the Settings surface: a shadcn `Dialog` shell (sidebar + routing, opened from the
sidebar gear and `⌘,`) with five panes — General (worktree dir + the 3-axis appearance
controls bound to `useTheme`), Providers (executable path, AskUserQuestion/PlanMode
toggles, default model/effort/features, Codex tuning, session mode), Notifications,
Remote Access, and About. The 697-line desktop `RemoteAccessSection` god-file is
decomposed into a `use-tunnel-status` state-machine hook plus tunnel/pairing/devices
sections. Adds the `settings` and `remote-access` daemon API clients, and wires provider
tuning defaults into the composer's effort/feature pickers (via a plain-state
`useProviderDefaults` hook). The Keybindings placeholder pane is dropped.

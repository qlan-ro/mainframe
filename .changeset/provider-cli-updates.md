---
'@qlan-ro/mainframe-types': minor
'@qlan-ro/mainframe-ui': minor
'@qlan-ro/mainframe-app-tauri': minor
---

Settings → Providers now shows the installed and latest version of the Claude Code and Codex CLIs, and can update them in place. Mainframe works out how each CLI was installed (Homebrew, npm, pnpm, Bun, or Claude Code's native installer) and runs the matching upgrade on the daemon host, showing its output as it goes. When the install method is unknown, or the update fails on permissions, it shows the command to run in a terminal. After an update the provider's model list refreshes without restarting Mainframe; running sessions keep the previous version until they restart. A dot on the Settings button and next to each provider marks an available update. Version checks run in the background every few hours and stay quiet when offline.

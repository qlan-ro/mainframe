# @qlan-ro/mainframe-types

## 2.11.0

### Minor Changes

- [#842](https://github.com/qlan-ro/mainframe/pull/842) [`fbde27f`](https://github.com/qlan-ro/mainframe/commit/fbde27ff17d90cabf83e495439027663bf3755aa) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add a Reveal in Finder button to every file preview tab, including files outside the project. HTML files now open with a Preview/Source toggle and an Open in browser button. The PDF and unsupported-file "Open externally" buttons now open the file in its default app.

- [#841](https://github.com/qlan-ro/mainframe/pull/841) [`6395e48`](https://github.com/qlan-ro/mainframe/commit/6395e487e0276f1a03586a7d55a43aaedae83575) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Settings → Providers now shows the installed and latest version of the Claude Code and Codex CLIs, and can update them in place. Mainframe works out how each CLI was installed (Homebrew, npm, pnpm, Bun, or Claude Code's native installer) and runs the matching upgrade on the daemon host, showing its output as it goes. When the install method is unknown, or the update fails on permissions, it shows the command to run in a terminal. After an update the provider's model list refreshes without restarting Mainframe; running sessions keep the previous version until they restart. Available updates also show on the update button in the left rail, next to Mainframe's own: it lists every pending update and can start each one, and a dot next to each provider in Settings marks which have one. Version checks run in the background every few hours and stay quiet when offline.

# @qlan-ro/mainframe-ui

## 2.11.0

### Minor Changes

- [#842](https://github.com/qlan-ro/mainframe/pull/842) [`fbde27f`](https://github.com/qlan-ro/mainframe/commit/fbde27ff17d90cabf83e495439027663bf3755aa) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add a Reveal in Finder button to every file preview tab, including files outside the project. HTML files now open with a Preview/Source toggle and an Open in browser button. The PDF and unsupported-file "Open externally" buttons now open the file in its default app.

- [#841](https://github.com/qlan-ro/mainframe/pull/841) [`6395e48`](https://github.com/qlan-ro/mainframe/commit/6395e487e0276f1a03586a7d55a43aaedae83575) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Settings → Providers now shows the installed and latest version of the Claude Code and Codex CLIs, and can update them in place. Mainframe works out how each CLI was installed (Homebrew, npm, pnpm, Bun, or Claude Code's native installer) and runs the matching upgrade on the daemon host, showing its output as it goes. When the install method is unknown, or the update fails on permissions, it shows the command to run in a terminal. After an update the provider's model list refreshes without restarting Mainframe; running sessions keep the previous version until they restart. Available updates also show on the update button in the left rail, next to Mainframe's own: it lists every pending update and can start each one, and a dot next to each provider in Settings marks which have one. Version checks run in the background every few hours and stay quiet when offline.

- [#836](https://github.com/qlan-ro/mainframe/pull/836) [`6e736ce`](https://github.com/qlan-ro/mainframe/commit/6e736cea8ec49dae48165d28e43b6c2cf5368cc2) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Show the session's worktree in the Session panel: the worktree directory name, or "Main checkout" when the session runs in the project itself. The row replaces the branch row's `wt` badge.

### Patch Changes

- [#829](https://github.com/qlan-ro/mainframe/pull/829) [`4a49009`](https://github.com/qlan-ro/mainframe/commit/4a490092925d9561d02a47c5bda98d920b989d9b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Prefer file name matches over folder path matches in the `@` mention picker. Offer referenceable chats across projects and providers with source labels.

- [#827](https://github.com/qlan-ro/mainframe/pull/827) [`0d32eae`](https://github.com/qlan-ro/mainframe/commit/0d32eaea63eb1253277fb428157edf4a39238ddc) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The Tasks board now opens sorted by number, newest first.

- [#838](https://github.com/qlan-ro/mainframe/pull/838) [`6fd747a`](https://github.com/qlan-ro/mainframe/commit/6fd747a3edd87cee26c86c3df10ddca9bb1b9034) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix files and folders whose names contain spaces. They now show in the Changes panel without quotes, open their diffs, stage and commit, and count their lines. The `@` picker can insert and browse them, writing `@"path with spaces"`. Go-to-definition and references work in projects whose path contains a space.

- [#839](https://github.com/qlan-ro/mainframe/pull/839) [`3370b36`](https://github.com/qlan-ro/mainframe/commit/3370b365fd304daacb919fd928a7e68e770cdf82) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the Review panel's change scopes. Branch now diffs each file against the branch's merge base instead of HEAD, so changes already committed on the branch show up, and renamed files read their original from the old path. Session now lists every file the session wrote or edited, committed or not, marked added, modified or deleted, and diffs each one from the session's own edits. When later work stops those edits from replaying, the diff compares the file with the last commit before the session started and says so. Switching scopes no longer opens the previous scope's first file. Uncommitted now lists new files inside new directories. Scopes that report no line counts no longer show `+0 −0`.

- [#833](https://github.com/qlan-ro/mainframe/pull/833) [`6fc4cb8`](https://github.com/qlan-ro/mainframe/commit/6fc4cb87e4932f24af6cca14a5bb1f4be1d22da6) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Let a text selection start on a link or file reference in chat messages without opening it, keep link text in copied selections, and keep code-block headers out of them.

- [#837](https://github.com/qlan-ro/mainframe/pull/837) [`9e18ed7`](https://github.com/qlan-ro/mainframe/commit/9e18ed736dd3bcb29abe6f099cf7c4661ca41245) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Keep following the latest response after sending a message when WebKit reports a layout scroll late, and return to the bottom when switching back to a chat you had scrolled up in.

- [#835](https://github.com/qlan-ro/mainframe/pull/835) [`04d1f18`](https://github.com/qlan-ro/mainframe/commit/04d1f18ef1d3b99d12e3d1d0a1f2fbfcf8b79ed8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Let the editor's Markdown preview use the full pane width instead of a centered 720px column.

- Updated dependencies [[`fbde27f`](https://github.com/qlan-ro/mainframe/commit/fbde27ff17d90cabf83e495439027663bf3755aa), [`6395e48`](https://github.com/qlan-ro/mainframe/commit/6395e487e0276f1a03586a7d55a43aaedae83575)]:
  - @qlan-ro/mainframe-types@2.11.0

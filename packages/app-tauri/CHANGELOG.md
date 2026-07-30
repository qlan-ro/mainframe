# @qlan-ro/mainframe-app-tauri

## 2.0.0-rc.17

### Minor Changes

- [#542](https://github.com/qlan-ro/mainframe/pull/542) [`39daa55`](https://github.com/qlan-ro/mainframe/commit/39daa550646397b31943ab6f747ea8f1fa42948d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The Run surface can open any http/https URL in a tab, tunnelling loopback URLs on a remote daemon.

### Patch Changes

- [#530](https://github.com/qlan-ro/mainframe/pull/530) [`dd2f683`](https://github.com/qlan-ro/mainframe/commit/dd2f683638bc003cb8ed27bdc7040fae3eb2cbd6) Thanks [@doruchiulan](https://github.com/doruchiulan)! - A session started with a slash command now gets a title. The daemon skipped its whole title path when the first message was a command, so the session stayed "Untitled" on every client, including the phone. It now derives the same fallback title from what you typed and replaces it with the generated summary moments later.

- [#529](https://github.com/qlan-ro/mainframe/pull/529) [`739b8d8`](https://github.com/qlan-ro/mainframe/commit/739b8d8e9baf1a808969fcb9e32c279703900c0a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the Claude adapter persisting session-scoped permission grants. It used to rewrite every permission update's destination to `.claude/settings.local.json` before echoing it back to the CLI, regardless of what the CLI itself declared — most damagingly for a permission-mode change, which landed as the project's new default mode. The adapter now forwards each update's declared destination as-is, with one added rule: a mode change is never forwarded to a persisting destination, so it can only ever apply to the running session.

  The same inverted rewrite is removed from the orphaned Node daemon (`packages/core`); its `setMode` guard was not ported there, since that daemon is unshipped and kept only for its `package.json` version.

  Entries this bug already wrote into `.claude/settings.local.json` — most notably a stray `defaultMode` — are not migrated or removed by this fix. If you see one you didn't set deliberately, delete it by hand.

- [#533](https://github.com/qlan-ro/mainframe/pull/533) [`88f1da1`](https://github.com/qlan-ro/mainframe/commit/88f1da1a3f87f63a1f88322005c4f0ba024b8a73) Thanks [@doruchiulan](https://github.com/doruchiulan)! - `pnpm tauri:dev` now provisions the daemon sidecar when it is missing, so a checkout that has never built one starts instead of failing in `build.rs` with an unexplained missing-resource panic.

- Updated dependencies [[`25ea938`](https://github.com/qlan-ro/mainframe/commit/25ea93843e5215a5c0a7b0b1f4ee7757b868be1c), [`ca7cda3`](https://github.com/qlan-ro/mainframe/commit/ca7cda36edd6a4523d959c43e3d66718dc61f6ee), [`3479a7f`](https://github.com/qlan-ro/mainframe/commit/3479a7f9c772f1baa1da6d9ff4ecdf889b7d68b1), [`1a21bd0`](https://github.com/qlan-ro/mainframe/commit/1a21bd001a67ba8fb5d05d9b6fcb503e9053502e), [`39daa55`](https://github.com/qlan-ro/mainframe/commit/39daa550646397b31943ab6f747ea8f1fa42948d), [`58b017f`](https://github.com/qlan-ro/mainframe/commit/58b017f57d7edc57ba277201c114201288d78975)]:
  - @qlan-ro/mainframe-ui@2.0.0-rc.17

## 2.0.0-rc.16

### Minor Changes

- [#523](https://github.com/qlan-ro/mainframe/pull/523) [`13078f0`](https://github.com/qlan-ro/mainframe/commit/13078f02c34cecea7e46c7c8c79f4acfe743bf2d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Turn two things agents write into chat into things you can act on. A slash instruction in an assistant message becomes a chip that adds the instruction to the composer or opens a new session prefilled with it — neither sends, so you still decide. A localhost URL becomes a chip that opens the link when the daemon is your own machine, and offers to tunnel the port when it isn't, so a dev server running on a remote daemon is one click away instead of an SSH session. Tunnels are listed in the remote-access pane with a stop control, and they close when the chat's scope does.

### Patch Changes

- [#522](https://github.com/qlan-ro/mainframe/pull/522) [`5ca7b08`](https://github.com/qlan-ro/mainframe/commit/5ca7b08e5725100ee5ea1cdb1fa58c197bdb0709) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Teach automations three things the editor will need: a `set_variable` step that names a value once and reuses it downstream, `once` schedules that fire at a single moment instead of on a repeating pattern, and webhook triggers that carry their registration. Variables resolve by scope, so a name set inside a repeat belongs to that repeat and does not leak to later steps. The engine, the scheduler, and the shared types all understand them; the editor UI for authoring them lands separately.

- [#522](https://github.com/qlan-ro/mainframe/pull/522) [`5ca7b08`](https://github.com/qlan-ro/mainframe/commit/5ca7b08e5725100ee5ea1cdb1fa58c197bdb0709) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Rebuild the automations editor around values you can name and reuse. Every text field in an automation now accepts `$name` references through the same picker, a Set value step names a result once so later steps can use it, and renaming that value rewrites every step that referred to it. Write `${name}` where a bare `$name` would run into surrounding text, as in `todo/${id}`.

  Each step that produces a value carries its own name, so reordering steps no longer silently repoints a reference at a different step. Two values sharing a name is reported as a problem on both, rather than one quietly winning.

  Webhook triggers can be registered from the editor, which now shows the signing secret alongside the URL — without it a registered hook rejected every delivery. The secret is shown on request and never leaves the editor; reveal it again any time, it does not change.

  Problems are reported on the step that caused them, including the ones the daemon finds at save time, which used to appear only as a toast. A reference to a name nothing defines is a warning rather than an error, so a prompt containing `$HOME` no longer blocks saving.

- [#528](https://github.com/qlan-ro/mainframe/pull/528) [`bbbb5e8`](https://github.com/qlan-ro/mainframe/commit/bbbb5e88adfa92d132242ddb5a1387a2f741b365) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix live background work never showing in a session. The daemon never asked its
  background-task tracker which tasks were running, so the pill above the composer
  stayed empty and the session row showed no in-progress state while agents, bash
  tasks, or workflows ran. This was reported against a workflow because a workflow
  runs longest, but it affected every kind of background work.

  Also fix orphaned background tasks staying stuck "running" forever after the
  CLI process exits (a stopped session, or a CLI crash) — the daemon now stops
  every live task for that chat on exit, so the pill and in-progress state clear
  along with it.

- [#521](https://github.com/qlan-ro/mainframe/pull/521) [`cde52fd`](https://github.com/qlan-ro/mainframe/commit/cde52fd3cc1649ffb56782cea1ba19f16caf50ca) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add the Setup Advisor's detection engine and rule catalog. The daemon can now fingerprint a project — languages, frameworks, testing and tooling configs, git host, project size — and match it against 76 recommendations spanning MCP servers, skills, hooks, subagents, and plugins. Each recommendation carries the evidence that earned it and where its command comes from, so a third-party install is a decision rather than a surprise. A read-only `GET /api/projects/{id}/automation-recommendations` route serves the report; parsing `pyproject.toml` for Python dependencies adds the `toml` crate (declared `0.8`, resolved 0.8.23) to `packages/core-rs`.

- Updated dependencies [[`5ca7b08`](https://github.com/qlan-ro/mainframe/commit/5ca7b08e5725100ee5ea1cdb1fa58c197bdb0709), [`5ca7b08`](https://github.com/qlan-ro/mainframe/commit/5ca7b08e5725100ee5ea1cdb1fa58c197bdb0709), [`eed8395`](https://github.com/qlan-ro/mainframe/commit/eed8395fd4333047d3fb7d1278f47bd697d4554c), [`4ce69b3`](https://github.com/qlan-ro/mainframe/commit/4ce69b3a35c4078605716cd2153a2da303bff9be), [`4a84d8c`](https://github.com/qlan-ro/mainframe/commit/4a84d8c993398258407d127b20dc2afd31db4b24), [`cde52fd`](https://github.com/qlan-ro/mainframe/commit/cde52fd3cc1649ffb56782cea1ba19f16caf50ca), [`13078f0`](https://github.com/qlan-ro/mainframe/commit/13078f02c34cecea7e46c7c8c79f4acfe743bf2d), [`84e28ef`](https://github.com/qlan-ro/mainframe/commit/84e28ef751338b9f237a2c84647d2dff00388c16), [`5f7fdca`](https://github.com/qlan-ro/mainframe/commit/5f7fdcaaef0c5b5a0b2624cc6d1037a70d1b4dbc), [`5f7fdca`](https://github.com/qlan-ro/mainframe/commit/5f7fdcaaef0c5b5a0b2624cc6d1037a70d1b4dbc)]:
  - @qlan-ro/mainframe-ui@2.0.0-rc.16

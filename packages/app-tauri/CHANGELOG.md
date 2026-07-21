# @qlan-ro/mainframe-app-tauri

## 2.0.0-rc.12

### Patch Changes

- [#488](https://github.com/qlan-ro/mainframe/pull/488) [`b2fe4da`](https://github.com/qlan-ro/mainframe/commit/b2fe4da7ef9f23e658d026d3d710b21189003350) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Close six functional gaps in the Rust daemon so it matches the Node daemon:
  - **Attachments**: images and files sent with a message were silently dropped (unported `processAttachments` stub); they now become inline image content and `<attached_file_path>` prefixes.
  - **Codex model catalog**: accept the `ultra` reasoning-effort variant; the codex `model/list` response no longer fails deserialization, so the catalog populates instead of staying empty.
  - **Suggestions**: `GET /api/projects/:id/suggestions` is ported and mounted (churn + TODO-scan starting points for the Welcome panel).
  - **External sessions**: the scan/import routes are wired through the ChatManager facade instead of returning 500, so external CLI sessions can be discovered and imported.
  - **Resume re-scan**: reopening a chat re-runs PR-URL detection, @-mention extraction, and plan/skill-file extraction, matching Node.
  - **Workspace trust**: `writeWorkspaceTrust` is ported and the trust-workspace command persists trust for the chat's worktree or project root.

- [#489](https://github.com/qlan-ro/mainframe/pull/489) [`458b48c`](https://github.com/qlan-ro/mainframe/commit/458b48c2fcec6c03ce298262e382e1d90a126391) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the Rust daemon's process-group kill silently doing nothing on Linux. `kill -TERM -<pid>` without `--` is parsed as a signal spec by Linux `kill`, which exits 0 without delivering — so stopped launch children (and sweep targets) were never signalled and ran until natural exit. Both group-kill shell-outs now pass `--` before the negative pid.

- [#489](https://github.com/qlan-ro/mainframe/pull/489) [`458b48c`](https://github.com/qlan-ro/mainframe/commit/458b48c2fcec6c03ce298262e382e1d90a126391) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the Rust daemon killing its own cloudflared tunnel moments after it connects. The tunnel manager stopped reading the child's stdout/stderr once the tunnel registered, closing the pipes; cloudflared died on SIGPIPE at its next log write (~100ms after "ready"). A drain task now keeps reading for the child's whole life, matching the Node daemon's persistent data handlers.

- Updated dependencies [[`32ad349`](https://github.com/qlan-ro/mainframe/commit/32ad349cb61088b807f3da5ad46d4b603832c009)]:
  - @qlan-ro/mainframe-ui@2.0.0-rc.12

## 2.0.0-rc.11

### Patch Changes

- Updated dependencies [[`cc4a2ad`](https://github.com/qlan-ro/mainframe/commit/cc4a2ad3ab43f6aff608b2a5860881b584397b5d), [`3e3ecbe`](https://github.com/qlan-ro/mainframe/commit/3e3ecbe3aa5536c1f1191a75caf10ad5451f1359), [`0a0cc88`](https://github.com/qlan-ro/mainframe/commit/0a0cc88a31f22a8742225540ce4d1f24d4819579), [`219ace1`](https://github.com/qlan-ro/mainframe/commit/219ace16e7be524b8282307dcd13e5b8f185e402), [`3e3ecbe`](https://github.com/qlan-ro/mainframe/commit/3e3ecbe3aa5536c1f1191a75caf10ad5451f1359)]:
  - @qlan-ro/mainframe-ui@2.0.0-rc.11

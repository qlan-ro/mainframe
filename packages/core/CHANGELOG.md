# @qlan-ro/mainframe-core

## 2.0.0-rc.6

### Minor Changes

- [#448](https://github.com/qlan-ro/mainframe/pull/448) [`030e4dc`](https://github.com/qlan-ro/mainframe/commit/030e4dccde96df128fcc92b8b2502318e0cd8911) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Replace v1 YAML workflows with Automations v2 (new /api/automations surface; /api/workflows removed).

### Patch Changes

- [#445](https://github.com/qlan-ro/mainframe/pull/445) [`d83749e`](https://github.com/qlan-ro/mainframe/commit/d83749e76ac48d5e87fbe1eaf539dea2908b084d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Pre-port hardening for the daemon Rust migration: GitService now runs raw `git` subprocesses with in-repo porcelain parsers (simple-git removed), SQLite schema evolution moved to numbered `PRAGMA user_version` migrations, black-box HTTP oracle tests added for settings/launch/attachments/tags/todos, and the wire contract frozen as generated snapshots under `docs/rust-port/`.

- Updated dependencies [[`030e4dc`](https://github.com/qlan-ro/mainframe/commit/030e4dccde96df128fcc92b8b2502318e0cd8911)]:
  - @qlan-ro/mainframe-types@2.0.0-rc.6

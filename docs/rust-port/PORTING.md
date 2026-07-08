# PORTING.md — the rule file for every Rust port agent

> Read this **before** translating any file. It is self-contained: it carries
> the crate map, the type/idiom map, the wire-parity rules, the forbidden
> patterns, the `PORT STATUS` trailer format, and the review protocol. You will
> not have the master plan — everything you need is here.

You are porting `@qlan-ro/mainframe-core` (the Node.js daemon, ~26k LOC) to a
Rust Cargo workspace at `packages/core-rs/`. The port is **structure-preserving**
("port, don't redesign"): same module boundaries, same file names, same function
names and order, translated file-by-file so a reviewer can diff the TypeScript
source and the Rust port side-by-side. You do **not** improve, simplify, batch,
or re-architect. Fidelity beats elegance. A flagged gap beats wrong code.

The two frozen contracts you must honor:

1. **Wire protocol** — every HTTP route, response envelope, and WebSocket event
   must serialize JSON-semantically identical (field-for-field, camelCase) to the
   Node daemon. Source of truth: `@qlan-ro/mainframe-types`, plus the frozen
   snapshots in `docs/rust-port/CONTRACT/` and the golden fixtures in
   `docs/rust-port/fixtures/`.
2. **On-disk data** — the Rust daemon opens any `~/.mainframe` SQLite DB the Node
   daemon ever wrote, and reads external CLI session files unchanged.

Nothing else in the repo imports the daemon: the UI packages (`ui`,
`app-electron`, `app-tauri`, `mobile`) depend only on `@qlan-ro/mainframe-types`
and speak HTTP + WS. Honor those two contracts and the port is correct.

---

## 1. How to use this document

- **Unit of work = one `.ts` file → one `.rs` file** per the crate map in §2.
  Same basename, same public item names (snake_cased), same function order.
  Translate the file's tests too (vitest → `#[cfg(test)]` module or a sibling
  `tests/` file), preserving every assertion literal.
- Before you write a line: find your file's row in §2, note its target
  `crate::module`, and read §3 (idioms), §4 (wire parity), §5 (forbidden
  patterns). When the file emits or accepts anything that crosses the wire,
  open the matching `CONTRACT/*.json` entry and `fixtures/*.json` file first.
- End every ported file with the §6 `PORT STATUS` trailer. Mark uncertainty with
  `// TODO(port): <reason>` and a graceful error path — never `todo!()`.
- Update the **status** column for your file in §2 (`todo` → `ported`; a
  reviewer sets `reviewed`).

Toolchain gates (all must pass; violations are mechanically rejected):

```sh
# run from packages/core-rs
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

Global Rust rules (non-negotiable): edition 2024; `#![forbid(unsafe_code)]` in
every crate; no `unwrap()`/`expect()`/`panic!()` outside `#[cfg(test)]` and the
binary's `main` boot path; no `todo!()`/`unimplemented!()`; `thiserror` for error
enums, **no `anyhow` in library crates**; `tokio` only (never
`std::thread::spawn`); serde with `#[serde(rename_all = "camelCase")]` and
`#[serde(skip_serializing_if = "Option::is_none")]` on optionals unless a fixture
shows an explicit `null`; dependencies only from the allowlist in §8.

---

## 2. Crate map & port checklist

One row per source file. `Rust target` is the crate and module the file ports
into (`crate::module`, `.rs` basename = `.ts` basename, snake_cased). `Status`:
`todo` → not started, `ported` → drafted + compiles, `reviewed` → passed both
reviews (§7).

Rule: **one `.rs` per `.ts`, same basename, same public item names, same function
order.** A reviewer must be able to open the pair side-by-side. Files over 300
lines are **not** pre-split — per-file granularity handles size, and splitting
would break the side-by-side diff.

`index.ts` files that only re-export become the crate's `lib.rs` (or a `mod.rs`
`pub use` block); they are listed so the checklist is complete but rarely carry
logic.

### 2.1 `mainframe-types` — pure serde structs/enums, one `.rs` per `.ts`

| TS source | Rust target | Status |
|---|---|---|
| `packages/types/src/adapter.ts` | `mainframe-types::adapter` | todo |
| `packages/types/src/api.ts` | `mainframe-types::api` | todo |
| `packages/types/src/background-task.ts` | `mainframe-types::background_task` | todo |
| `packages/types/src/chat.ts` | `mainframe-types::chat` | todo |
| `packages/types/src/command.ts` | `mainframe-types::command` | todo |
| `packages/types/src/content.ts` | `mainframe-types::content` | todo |
| `packages/types/src/context.ts` | `mainframe-types::context` | todo |
| `packages/types/src/device.ts` | `mainframe-types::device` | todo |
| `packages/types/src/display.ts` | `mainframe-types::display` | todo |
| `packages/types/src/events.ts` | `mainframe-types::events` | todo |
| `packages/types/src/git.ts` | `mainframe-types::git` | todo |
| `packages/types/src/launch.ts` | `mainframe-types::launch` | todo |
| `packages/types/src/lsp.ts` | `mainframe-types::lsp` | todo |
| `packages/types/src/plugin.ts` | `mainframe-types::plugin` | todo |
| `packages/types/src/search.ts` | `mainframe-types::search` | todo |
| `packages/types/src/settings.ts` | `mainframe-types::settings` | todo |
| `packages/types/src/skill.ts` | `mainframe-types::skill` | todo |
| `packages/types/src/suggestion.ts` | `mainframe-types::suggestion` | todo |
| `packages/types/src/tags.ts` | `mainframe-types::tags` | todo |
| `packages/types/src/task-progress.ts` | `mainframe-types::task_progress` | todo |
| `packages/types/src/workflow.ts` | `mainframe-types::workflow` | todo |
| `packages/types/src/index.ts` | `mainframe-types::lib` (re-exports) | todo |
| `packages/types/src/host/daemon-target.ts` | `mainframe-types::host::daemon_target` | todo |
| `packages/types/src/host/external-schemes.ts` | `mainframe-types::host::external_schemes` | todo |
| `packages/types/src/host/host-bridge.ts` | `mainframe-types::host::host_bridge` | todo |
| `packages/types/src/host/host-contract.ts` | `mainframe-types::host::host_contract` | todo |

Note: `host/*` are the desktop-shell (Tauri/Electron) bridge contracts. The
daemon itself does not consume them; port for completeness, but if a `host/*`
type references no daemon-side code, mark it low-priority in its trailer.
`__fixtures__/` and `__tests__/` under `types/` are TS test scaffolding — port
the `*.test.ts` assertions alongside the type they cover, not as standalone
files.

### 2.2 `mainframe-runtime` — config, logging, auth, version

| TS source | Rust target | Status |
|---|---|---|
| `packages/core/src/config.ts` | `mainframe-runtime::config` | todo |
| `packages/core/src/logger.ts` | `mainframe-runtime::logging` | todo |
| `packages/core/src/version.ts` | `mainframe-runtime::version` | todo |
| `packages/core/src/auth/index.ts` | `mainframe-runtime::auth` (re-exports) | todo |
| `packages/core/src/auth/token.ts` | `mainframe-runtime::auth::token` | todo |
| `packages/core/src/auth/validate-authed-token.ts` | `mainframe-runtime::auth::validate_authed_token` | todo |

### 2.3 `mainframe-db` — rusqlite schema, migrations, repositories

| TS source | Rust target | Status |
|---|---|---|
| `packages/core/src/db/schema.ts` | `mainframe-db::schema` | todo |
| `packages/core/src/db/migrations.ts` | `mainframe-db::migrations` | todo |
| `packages/core/src/db/index.ts` | `mainframe-db::lib` (Db handle + re-exports) | todo |
| `packages/core/src/db/chats.ts` | `mainframe-db::chats` | todo |
| `packages/core/src/db/chat-tags.ts` | `mainframe-db::chat_tags` | todo |
| `packages/core/src/db/devices.ts` | `mainframe-db::devices` | todo |
| `packages/core/src/db/projects.ts` | `mainframe-db::projects` | todo |
| `packages/core/src/db/settings.ts` | `mainframe-db::settings` | todo |
| `packages/core/src/db/tags.ts` | `mainframe-db::tags` | todo |

Migrations honor `PRAGMA user_version` with the same numbers as the TS
`migrations.ts`. Every query runs through the `Db` handle
(`tokio::task::spawn_blocking`, single WAL connection). Parse JSON columns
through a `safe_json_array` equivalent — never a bare `serde_json::from_str` that
propagates on malformed data.

### 2.4 `mainframe-git` — exec_git + porcelain parsers + project lock

| TS source | Rust target | Status |
|---|---|---|
| `packages/core/src/git/git-exec.ts` | `mainframe-git::git_exec` | todo |
| `packages/core/src/git/git-parse.ts` | `mainframe-git::git_parse` | todo |
| `packages/core/src/git/git-service.ts` | `mainframe-git::git_service` | todo |
| `packages/core/src/git/project-lock.ts` | `mainframe-git::project_lock` | todo |
| `packages/core/src/server/routes/exec-git.ts` | `mainframe-git::exec_git` (the raw `execGit` helper, not a route) | todo |

`GitService` was converted off `simple-git` onto `execGit` + explicit porcelain
parsing in Phase 0 — you translate **our** parsers only, never a third-party
library's output format.

### 2.5 `mainframe-display` — adapter-agnostic display pipeline

The `messages/` module is split between this crate and
`mainframe-adapter-claude::messages` (per the pre-port audit: the module is
Claude-specific except for the generic display pieces). Assign each file by one
test: **does it reference Claude event / JSONL shapes?** If yes → adapter-claude.
If it operates on the neutral `DisplayMessage` pipeline → here. The split below is
the intended default; a reviewer confirms per file and the trailer must state
which side it landed on.

| TS source | Rust target | Status |
|---|---|---|
| `packages/core/src/messages/display-pipeline.ts` | `mainframe-display::display_pipeline` | todo |
| `packages/core/src/messages/display-helpers.ts` | `mainframe-display::display_helpers` | todo |
| `packages/core/src/messages/tool-categorization.ts` | `mainframe-display::tool_categorization` | todo |
| `packages/core/src/messages/tool-grouping.ts` | `mainframe-display::tool_grouping` | todo |
| `packages/core/src/messages/truncate-tool-content.ts` | `mainframe-display::truncate_tool_content` | todo |
| `packages/core/src/messages/parse-unified-diff.ts` | `mainframe-display::parse_unified_diff` | todo |
| `packages/core/src/messages/index.ts` | `mainframe-display::lib` (re-exports; some exports land in adapter-claude) | todo |

### 2.6 `mainframe-adapter-api` — Adapter / AdapterSession / SessionSink traits

| TS source | Rust target | Status |
|---|---|---|
| `packages/core/src/adapters/index.ts` | `mainframe-adapter-api::lib` (Adapter/AdapterSession/SessionSink traits, ControlRequest/Response) | todo |
| `packages/core/src/adapters/resolve-executable.ts` | `mainframe-adapter-api::resolve_executable` | todo |
| `packages/core/src/testing/recording-format.ts` | `mainframe-adapter-api::testing::recording_format` | todo |
| `packages/core/src/testing/recording-sink.ts` | `mainframe-adapter-api::testing::recording_sink` | todo |
| `packages/core/src/testing/record-wrapper.ts` | `mainframe-adapter-api::testing::record_wrapper` | todo |
| `packages/core/src/testing/capture-fx.ts` | `mainframe-adapter-api::testing::capture_fx` | todo |
| `packages/core/src/testing/replay-core.ts` | `mainframe-adapter-api::testing::replay_core` | todo |

The adapter trait interfaces themselves live in `@qlan-ro/mainframe-types`
(`adapter.ts`) as data; the trait definitions (`Adapter`, `AdapterSession`,
`SessionSink`) live here. `testing/*` is the record/replay harness — a port asset
reused by the differential harness; gate it behind a `testing` cargo feature and
note that in each trailer.

### 2.7 `mainframe-adapter-claude` — Claude CLI integration

| TS source | Rust target | Status |
|---|---|---|
| `packages/core/src/plugins/builtin/claude/adapter.ts` | `mainframe-adapter-claude::adapter` | todo |
| `packages/core/src/plugins/builtin/claude/index.ts` | `mainframe-adapter-claude::lib` (re-exports) | todo |
| `packages/core/src/plugins/builtin/claude/constants.ts` | `mainframe-adapter-claude::constants` | todo |
| `packages/core/src/plugins/builtin/claude/session.ts` | `mainframe-adapter-claude::session` | todo |
| `packages/core/src/plugins/builtin/claude/session-control.ts` | `mainframe-adapter-claude::session_control` | todo |
| `packages/core/src/plugins/builtin/claude/events.ts` | `mainframe-adapter-claude::events` | todo |
| `packages/core/src/plugins/builtin/claude/assistant-event.ts` | `mainframe-adapter-claude::assistant_event` | todo |
| `packages/core/src/plugins/builtin/claude/user-event.ts` | `mainframe-adapter-claude::user_event` | todo |
| `packages/core/src/plugins/builtin/claude/task-events.ts` | `mainframe-adapter-claude::task_events` | todo |
| `packages/core/src/plugins/builtin/claude/history.ts` | `mainframe-adapter-claude::history` | todo |
| `packages/core/src/plugins/builtin/claude/history-converters.ts` | `mainframe-adapter-claude::history_converters` | todo |
| `packages/core/src/plugins/builtin/claude/history-subagents.ts` | `mainframe-adapter-claude::history_subagents` | todo |
| `packages/core/src/plugins/builtin/claude/history-tool-result.ts` | `mainframe-adapter-claude::history_tool_result` | todo |
| `packages/core/src/plugins/builtin/claude/external-sessions.ts` | `mainframe-adapter-claude::external_sessions` | todo |
| `packages/core/src/plugins/builtin/claude/external-session-cache.ts` | `mainframe-adapter-claude::external_session_cache` | todo |
| `packages/core/src/plugins/builtin/claude/external-session-enrich.ts` | `mainframe-adapter-claude::external_session_enrich` | todo |
| `packages/core/src/plugins/builtin/claude/external-session-paths.ts` | `mainframe-adapter-claude::external_session_paths` | todo |
| `packages/core/src/plugins/builtin/claude/frontmatter.ts` | `mainframe-adapter-claude::frontmatter` | todo |
| `packages/core/src/plugins/builtin/claude/plan-mode-handler.ts` | `mainframe-adapter-claude::plan_mode_handler` | todo |
| `packages/core/src/plugins/builtin/claude/pr-detection.ts` | `mainframe-adapter-claude::pr_detection` | todo |
| `packages/core/src/plugins/builtin/claude/probe-models.ts` | `mainframe-adapter-claude::probe_models` | todo |
| `packages/core/src/plugins/builtin/claude/skills.ts` | `mainframe-adapter-claude::skills` | todo |
| `packages/core/src/plugins/builtin/claude/skill-path.ts` | `mainframe-adapter-claude::skill_path` | todo |
| `packages/core/src/plugins/builtin/claude/trust-store.ts` | `mainframe-adapter-claude::trust_store` | todo |
| `packages/core/src/plugins/builtin/claude/tuning.ts` | `mainframe-adapter-claude::tuning` | todo |
| `packages/core/src/messages/message-parsing.ts` | `mainframe-adapter-claude::messages::message_parsing` | todo |
| `packages/core/src/messages/message-grouping.ts` | `mainframe-adapter-claude::messages::message_grouping` | todo |
| `packages/core/src/messages/parse-ask-user-question.ts` | `mainframe-adapter-claude::messages::parse_ask_user_question` | todo |
| `packages/core/src/messages/read-tool-result-from-jsonl.ts` | `mainframe-adapter-claude::messages::read_tool_result_from_jsonl` | todo |
| `packages/core/src/messages/session-files.ts` | `mainframe-adapter-claude::messages::session_files` | todo |
| `packages/core/src/messages/task-subject-backfill.ts` | `mainframe-adapter-claude::messages::task_subject_backfill` | todo |

**Sacred:** the stream-json event shapes, spawn args, stdin `control_request`
envelopes, SIGTERM→SIGKILL + 10s SIGINT interrupt semantics, and JSONL history
formats are copied exactly from the TS source and its tests. Unknown inbound
event types are logged loudly once per type and skipped — never a hard error. The
15 claude `__tests__` files port assertion-for-assertion.

### 2.8 `mainframe-adapter-codex` — Codex CLI integration

| TS source | Rust target | Status |
|---|---|---|
| `packages/core/src/plugins/builtin/codex/adapter.ts` | `mainframe-adapter-codex::adapter` | todo |
| `packages/core/src/plugins/builtin/codex/index.ts` | `mainframe-adapter-codex::lib` (re-exports) | todo |
| `packages/core/src/plugins/builtin/codex/session.ts` | `mainframe-adapter-codex::session` | todo |
| `packages/core/src/plugins/builtin/codex/jsonrpc.ts` | `mainframe-adapter-codex::jsonrpc` | todo |
| `packages/core/src/plugins/builtin/codex/event-mapper.ts` | `mainframe-adapter-codex::event_mapper` | todo |
| `packages/core/src/plugins/builtin/codex/approval-handler.ts` | `mainframe-adapter-codex::approval_handler` | todo |
| `packages/core/src/plugins/builtin/codex/plan-mode-handler.ts` | `mainframe-adapter-codex::plan_mode_handler` | todo |
| `packages/core/src/plugins/builtin/codex/rollout-reader.ts` | `mainframe-adapter-codex::rollout_reader` | todo |
| `packages/core/src/plugins/builtin/codex/thread-registry.ts` | `mainframe-adapter-codex::thread_registry` | todo |
| `packages/core/src/plugins/builtin/codex/history.ts` | `mainframe-adapter-codex::history` | todo |
| `packages/core/src/plugins/builtin/codex/item-types.ts` | `mainframe-adapter-codex::item_types` | todo |
| `packages/core/src/plugins/builtin/codex/turn-config.ts` | `mainframe-adapter-codex::turn_config` | todo |
| `packages/core/src/plugins/builtin/codex/types.ts` | `mainframe-adapter-codex::types` | todo |

### 2.9 `mainframe-plugins` — builtin registry, capability contexts, todos

| TS source | Rust target | Status |
|---|---|---|
| `packages/core/src/plugins/manager.ts` | `mainframe-plugins::manager` | todo |
| `packages/core/src/plugins/context.ts` | `mainframe-plugins::context` | todo |
| `packages/core/src/plugins/config-context.ts` | `mainframe-plugins::config_context` | todo |
| `packages/core/src/plugins/db-context.ts` | `mainframe-plugins::db_context` | todo |
| `packages/core/src/plugins/ui-context.ts` | `mainframe-plugins::ui_context` | todo |
| `packages/core/src/plugins/attachment-context.ts` | `mainframe-plugins::attachment_context` | todo |
| `packages/core/src/plugins/event-bus.ts` | `mainframe-plugins::event_bus` | todo |
| `packages/core/src/plugins/security/manifest-validator.ts` | `mainframe-plugins::security::manifest_validator` | todo |
| `packages/core/src/plugins/services/chat-service.ts` | `mainframe-plugins::services::chat_service` | todo |
| `packages/core/src/plugins/services/project-service.ts` | `mainframe-plugins::services::project_service` | todo |
| `packages/core/src/plugins/builtin/todos/index.ts` | `mainframe-plugins::todos` | todo |

v1 is **builtin-only**: claude, codex, and todos are native modules behind the
same `/api/plugins` HTTP surface and capability model. Dynamic third-party JS
plugin loading is dropped for v1 — preserve the manifest/capability model so a
WASM loader can restore it later, but do not port a JS runtime. This is the one
deliberate behavior change; flag any code path that assumed external plugins with
`// TODO(port): external plugin loading dropped in v1`.

### 2.10 `mainframe-chat` — ChatManager + orchestration

Port in dependency order (leaves first, `chat_manager` last):

| TS source | Rust target | Status |
|---|---|---|
| `packages/core/src/chat/types.ts` | `mainframe-chat::types` | todo |
| `packages/core/src/chat/message-cache.ts` | `mainframe-chat::message_cache` | todo |
| `packages/core/src/chat/display-emitter.ts` | `mainframe-chat::display_emitter` | todo |
| `packages/core/src/chat/context-tracker.ts` | `mainframe-chat::context_tracker` | todo |
| `packages/core/src/chat/permission-manager.ts` | `mainframe-chat::permission_manager` | todo |
| `packages/core/src/chat/permission-handler.ts` | `mainframe-chat::permission_handler` | todo |
| `packages/core/src/chat/plan-mode-actions.ts` | `mainframe-chat::plan_mode_actions` | todo |
| `packages/core/src/chat/plan-mode-handler.ts` | `mainframe-chat::plan_mode_handler` | todo |
| `packages/core/src/chat/config-manager.ts` | `mainframe-chat::config_manager` | todo |
| `packages/core/src/chat/resolve-tuning.ts` | `mainframe-chat::resolve_tuning` | todo |
| `packages/core/src/chat/resolve-tuning-for-chat.ts` | `mainframe-chat::resolve_tuning_for_chat` | todo |
| `packages/core/src/chat/attachment-processor.ts` | `mainframe-chat::attachment_processor` | todo |
| `packages/core/src/chat/idle-scanner.ts` | `mainframe-chat::idle_scanner` | todo |
| `packages/core/src/chat/title-generator.ts` | `mainframe-chat::title_generator` | todo |
| `packages/core/src/chat/external-session-service.ts` | `mainframe-chat::external_session_service` | todo |
| `packages/core/src/chat/event-handler.ts` | `mainframe-chat::event_handler` | todo |
| `packages/core/src/chat/lifecycle-manager.ts` | `mainframe-chat::lifecycle_manager` | todo |
| `packages/core/src/chat/chat-manager.ts` | `mainframe-chat::chat_manager` | todo |
| `packages/core/src/chat/index.ts` | `mainframe-chat::lib` (re-exports) | todo |

The permission queue stays **FIFO per chat**. Per-chat mutable state (queue,
permission FIFO, plan-mode) lives behind one `Arc<Mutex<ChatState>>` per chat —
**never hold that lock across an `.await` that emits events** (the chat lock is a
leaf lock; acquire the manager map first, drop the map ref, then take the chat
lock). See §3's EventEmitter and lock idioms.

### 2.11 `mainframe-background-tasks`

| TS source | Rust target | Status |
|---|---|---|
| `packages/core/src/background-tasks/tracker.ts` | `mainframe-background-tasks::tracker` | todo |
| `packages/core/src/background-tasks/spool-root.ts` | `mainframe-background-tasks::spool_root` | todo |
| `packages/core/src/background-tasks/spool-walker.ts` | `mainframe-background-tasks::spool_walker` | todo |
| `packages/core/src/background-tasks/spool-validator.ts` | `mainframe-background-tasks::spool_validator` | todo |
| `packages/core/src/background-tasks/kill.ts` | `mainframe-background-tasks::kill` (process-group kill) | todo |
| `packages/core/src/background-tasks/lsof.ts` | `mainframe-background-tasks::lsof` | todo |
| `packages/core/src/background-tasks/liveness.ts` | `mainframe-background-tasks::liveness` | todo |
| `packages/core/src/background-tasks/reconcile.ts` | `mainframe-background-tasks::reconcile` | todo |
| `packages/core/src/background-tasks/encoding.ts` | `mainframe-background-tasks::encoding` | todo |

### 2.12 `mainframe-launch` — launcher + tunnels

| TS source | Rust target | Status |
|---|---|---|
| `packages/core/src/launch/launch-config.ts` | `mainframe-launch::launch_config` | todo |
| `packages/core/src/launch/launch-manager.ts` | `mainframe-launch::launch_manager` | todo |
| `packages/core/src/launch/launch-registry.ts` | `mainframe-launch::launch_registry` | todo |
| `packages/core/src/launch/launch-process-state.ts` | `mainframe-launch::launch_process_state` | todo |
| `packages/core/src/launch/expand-variables.ts` | `mainframe-launch::expand_variables` | todo |
| `packages/core/src/launch/index.ts` | `mainframe-launch::lib` (re-exports) | todo |
| `packages/core/src/tunnel/tunnel-manager.ts` | `mainframe-launch::tunnel_manager` | todo |
| `packages/core/src/tunnel/index.ts` | `mainframe-launch::tunnel` (re-exports) | todo |

Port detection = TCP connect (tokio). Tunnels + title generation + cloudflared
stay shell-outs to the same external binaries with the same args.

### 2.13 `mainframe-lsp` — WS↔stdio LSP proxy

| TS source | Rust target | Status |
|---|---|---|
| `packages/core/src/lsp/lsp-manager.ts` | `mainframe-lsp::lsp_manager` | todo |
| `packages/core/src/lsp/lsp-connection.ts` | `mainframe-lsp::lsp_connection` | todo |
| `packages/core/src/lsp/lsp-proxy.ts` | `mainframe-lsp::lsp_proxy` | todo |
| `packages/core/src/lsp/lsp-registry.ts` | `mainframe-lsp::lsp_registry` | todo |
| `packages/core/src/lsp/index.ts` | `mainframe-lsp::lib` (re-exports) | todo |

Port the `Content-Length` framing logic by hand — do **not** pull an LSP
framework crate.

### 2.14 `mainframe-workflows` — DSL, engine, triggers (port LAST)

| TS source | Rust target | Status |
|---|---|---|
| `packages/core/src/workflows/dsl/types.ts` | `mainframe-workflows::dsl::types` | todo |
| `packages/core/src/workflows/dsl/schema.ts` | `mainframe-workflows::dsl::schema` | todo |
| `packages/core/src/workflows/dsl/parse.ts` | `mainframe-workflows::dsl::parse` | todo |
| `packages/core/src/workflows/dsl/verify.ts` | `mainframe-workflows::dsl::verify` | todo |
| `packages/core/src/workflows/engine/types.ts` | `mainframe-workflows::engine::types` | todo |
| `packages/core/src/workflows/engine/engine.ts` | `mainframe-workflows::engine::engine` | todo |
| `packages/core/src/workflows/engine/blocks.ts` | `mainframe-workflows::engine::blocks` | todo |
| `packages/core/src/workflows/engine/scope.ts` | `mainframe-workflows::engine::scope` | todo |
| `packages/core/src/workflows/engine/failure.ts` | `mainframe-workflows::engine::failure` | todo |
| `packages/core/src/workflows/engine/executors/agent.ts` | `mainframe-workflows::engine::executors::agent` | todo |
| `packages/core/src/workflows/engine/executors/call.ts` | `mainframe-workflows::engine::executors::call` | todo |
| `packages/core/src/workflows/engine/executors/connector.ts` | `mainframe-workflows::engine::executors::connector` | todo |
| `packages/core/src/workflows/engine/executors/question.ts` | `mainframe-workflows::engine::executors::question` | todo |
| `packages/core/src/workflows/connectors/registry.ts` | `mainframe-workflows::connectors::registry` | todo |
| `packages/core/src/workflows/connectors/types.ts` | `mainframe-workflows::connectors::types` | todo |
| `packages/core/src/workflows/connectors/bash.ts` | `mainframe-workflows::connectors::bash` | todo |
| `packages/core/src/workflows/connectors/files.ts` | `mainframe-workflows::connectors::files` | todo |
| `packages/core/src/workflows/connectors/http.ts` | `mainframe-workflows::connectors::http` | todo |
| `packages/core/src/workflows/store/run-store.ts` | `mainframe-workflows::store::run_store` | todo |
| `packages/core/src/workflows/store/interaction-store.ts` | `mainframe-workflows::store::interaction_store` | todo |
| `packages/core/src/workflows/store/types.ts` | `mainframe-workflows::store::types` | todo |
| `packages/core/src/workflows/triggers/scheduler.ts` | `mainframe-workflows::triggers::scheduler` | todo |
| `packages/core/src/workflows/triggers/events.ts` | `mainframe-workflows::triggers::events` | todo |
| `packages/core/src/workflows/projection/run-tree.ts` | `mainframe-workflows::projection::run_tree` | todo |
| `packages/core/src/workflows/template/render.ts` | `mainframe-workflows::template::render` | todo |
| `packages/core/src/workflows/agent-port.ts` | `mainframe-workflows::agent_port` | todo |
| `packages/core/src/workflows/agent-waits.ts` | `mainframe-workflows::agent_waits` | todo |
| `packages/core/src/workflows/credentials.ts` | `mainframe-workflows::credentials` | todo |
| `packages/core/src/workflows/db.ts` | `mainframe-workflows::db` | todo |
| `packages/core/src/workflows/interactions.ts` | `mainframe-workflows::interactions` | todo |
| `packages/core/src/workflows/loader.ts` | `mainframe-workflows::loader` | todo |
| `packages/core/src/workflows/reconciler.ts` | `mainframe-workflows::reconciler` | todo |
| `packages/core/src/workflows/writer.ts` | `mainframe-workflows::writer` | todo |
| `packages/core/src/workflows/index.ts` | `mainframe-workflows::lib` (re-exports) | todo |

The editor YAML output must satisfy the daemon Zod schema + `verifyWorkflow`, so
`serde_yaml` output must round-trip through the ported schema. JSONata: evaluate
`jsonata-rs` maturity when this crate starts; fallback is the documented
DSL-subset evaluator. This is a **blocker to resolve before porting the engine**,
not a local decision (§8).

### 2.15 `mainframe-services` — cross-cutting daemon services

| TS source | Rust target | Status |
|---|---|---|
| `packages/core/src/workspace/index.ts` | `mainframe-services::workspace` (re-exports) | todo |
| `packages/core/src/workspace/worktree.ts` | `mainframe-services::workspace::worktree` | todo |
| `packages/core/src/workspace/session-files.ts` | `mainframe-services::workspace::session_files` | todo |
| `packages/core/src/attachment/index.ts` | `mainframe-services::attachment` (re-exports) | todo |
| `packages/core/src/attachment/attachment-store.ts` | `mainframe-services::attachment::attachment_store` | todo |
| `packages/core/src/attachment/attachment-helpers.ts` | `mainframe-services::attachment::attachment_helpers` | todo |
| `packages/core/src/push/index.ts` | `mainframe-services::push` (re-exports) | todo |
| `packages/core/src/push/push-service.ts` | `mainframe-services::push::push_service` | todo |
| `packages/core/src/notifications/notification-config.ts` | `mainframe-services::notifications::notification_config` | todo |
| `packages/core/src/settings/provider-config.ts` | `mainframe-services::settings::provider_config` | todo |
| `packages/core/src/commands/registry.ts` | `mainframe-services::commands::registry` | todo |
| `packages/core/src/commands/wrap.ts` | `mainframe-services::commands::wrap` | todo |
| `packages/core/src/todos/normalize.ts` | `mainframe-services::todos::normalize` | todo |
| `packages/core/src/files/file-watcher.ts` | `mainframe-services::files::file_watcher` | todo |
| `packages/core/src/lib/tag-color.ts` | `mainframe-services::lib::tag_color` | todo |
| `packages/core/src/lib/validate-tag-name.ts` | `mainframe-services::lib::validate_tag_name` | todo |

`file-watcher` uses the `notify` crate — **verify event semantics vs Node's
`fs.watch` on macOS** (debounce identically; the `file.changed` WS event must
fire on the same triggers). `lib/*` are pure shared helpers; if a reviewer finds
a tighter home (e.g. `tag_color` only used by `mainframe-db`), the trailer
records the move.

### 2.16 `mainframe-server` — axum app, WS, routes

| TS source | Rust target | Status |
|---|---|---|
| `packages/core/src/server/http.ts` | `mainframe-server::http` | todo |
| `packages/core/src/server/index.ts` | `mainframe-server::lib` (re-exports) | todo |
| `packages/core/src/server/websocket.ts` | `mainframe-server::websocket` | todo |
| `packages/core/src/server/ws-file-watch.ts` | `mainframe-server::ws_file_watch` | todo |
| `packages/core/src/server/ws-schemas.ts` | `mainframe-server::ws_schemas` | todo |
| `packages/core/src/server/fs-utils.ts` | `mainframe-server::fs_utils` | todo |
| `packages/core/src/server/ripgrep.ts` | `mainframe-server::ripgrep` (shell out to bundled `rg`, same flags) | todo |
| `packages/core/src/server/adapter-replay.ts` | `mainframe-server::adapter_replay` | todo |
| `packages/core/src/server/middleware/auth.ts` | `mainframe-server::middleware::auth` | todo |
| `packages/core/src/server/suggestions/build-suggestions.ts` | `mainframe-server::suggestions::build_suggestions` | todo |
| `packages/core/src/server/routes/index.ts` | `mainframe-server::routes` (mount table) | todo |
| `packages/core/src/server/routes/respond.ts` | `mainframe-server::routes::respond` (the envelope: `ok`/`ok_empty`/`fail`) | todo |
| `packages/core/src/server/routes/schemas.ts` | `mainframe-server::routes::schemas` | todo |
| `packages/core/src/server/routes/types.ts` | `mainframe-server::routes::types` | todo |
| `packages/core/src/server/routes/path-utils.ts` | `mainframe-server::routes::path_utils` | todo |
| `packages/core/src/server/routes/async-handler.ts` | `mainframe-server::routes::async_handler` | todo |
| `packages/core/src/server/routes/adapters.ts` | `mainframe-server::routes::adapters` | todo |
| `packages/core/src/server/routes/agents.ts` | `mainframe-server::routes::agents` | todo |
| `packages/core/src/server/routes/attachments.ts` | `mainframe-server::routes::attachments` | todo |
| `packages/core/src/server/routes/auth.ts` | `mainframe-server::routes::auth` | todo |
| `packages/core/src/server/routes/background-tasks.ts` | `mainframe-server::routes::background_tasks` | todo |
| `packages/core/src/server/routes/chat-commands.ts` | `mainframe-server::routes::chat_commands` | todo |
| `packages/core/src/server/routes/chats.ts` | `mainframe-server::routes::chats` | todo |
| `packages/core/src/server/routes/commands.ts` | `mainframe-server::routes::commands` | todo |
| `packages/core/src/server/routes/context.ts` | `mainframe-server::routes::context` | todo |
| `packages/core/src/server/routes/device.ts` | `mainframe-server::routes::device` | todo |
| `packages/core/src/server/routes/external-sessions.ts` | `mainframe-server::routes::external_sessions` | todo |
| `packages/core/src/server/routes/files.ts` | `mainframe-server::routes::files` | todo |
| `packages/core/src/server/routes/git.ts` | `mainframe-server::routes::git` | todo |
| `packages/core/src/server/routes/git-write.ts` | `mainframe-server::routes::git_write` | todo |
| `packages/core/src/server/routes/git-chat.ts` | `mainframe-server::routes::git_chat` | todo |
| `packages/core/src/server/routes/launch.ts` | `mainframe-server::routes::launch` | todo |
| `packages/core/src/server/routes/lsp-routes.ts` | `mainframe-server::routes::lsp_routes` | todo |
| `packages/core/src/server/routes/projects.ts` | `mainframe-server::routes::projects` | todo |
| `packages/core/src/server/routes/search.ts` | `mainframe-server::routes::search` | todo |
| `packages/core/src/server/routes/settings.ts` | `mainframe-server::routes::settings` | todo |
| `packages/core/src/server/routes/skills.ts` | `mainframe-server::routes::skills` | todo |
| `packages/core/src/server/routes/suggestions.ts` | `mainframe-server::routes::suggestions` | todo |
| `packages/core/src/server/routes/tags.ts` | `mainframe-server::routes::tags` | todo |
| `packages/core/src/server/routes/tunnel.ts` | `mainframe-server::routes::tunnel` | todo |
| `packages/core/src/server/routes/workflows.ts` | `mainframe-server::routes::workflows` | todo |
| `packages/core/src/server/routes/workflow-admin.ts` | `mainframe-server::routes::workflow_admin` | todo |
| `packages/core/src/server/routes/worktree.ts` | `mainframe-server::routes::worktree` | todo |
| `packages/core/src/server/types/express.d.ts` | **N/A** — Express type augmentation; axum has no equivalent. Do not port; note in the mount-table trailer. | n/a |

`exec-git.ts` lives under `routes/` in the TS tree but ports to
`mainframe-git::exec_git` (§2.4), not here. `respond.ts` is the single envelope
module — `ok(data)` → `{"success":true,"data":...}`, `ok_empty()` →
`{"success":true}`, `fail(status, error)` → `{"success":false,"error":"..."}`.
Reproduce the known deviations exactly (§4).

### 2.17 `mainframe-daemon` — the binary

| TS source | Rust target | Status |
|---|---|---|
| `packages/core/src/index.ts` | `mainframe-daemon::main` (boot + ordered shutdown) | todo |
| `packages/core/src/cli/early-flags.ts` | `mainframe-daemon::cli::early_flags` | todo |
| `packages/core/src/cli/pair.ts` | `mainframe-daemon::cli::pair` | todo |
| `packages/core/src/cli/status.ts` | `mainframe-daemon::cli::status` | todo |
| `packages/core/src/cli/update.ts` | `mainframe-daemon::cli::update` | todo |

Boot order (from `index.ts`): config → auth secret → DB → registries →
ChatManager → plugins (claude/codex/todos) → HTTP/WS server → background reconcile
→ optional tunnel. `SIGINT`/`SIGTERM` run an ordered shutdown with `killAll` on
children; `detached:false` semantics must hold (children die with the daemon).
The binary's `main` is the **only** place `expect()` is permitted, and only for
unrecoverable boot errors.

---

## 3. Type & idiom map

### 3.1 Table

| TypeScript | Rust |
|---|---|
| `interface Foo { a?: string }` | `struct Foo { #[serde(skip_serializing_if = "Option::is_none")] a: Option<String> }` — match the Node serializer; absent-vs-null must round-trip identically (check the fixture) |
| Discriminated union on `type` | `#[serde(tag = "type")] enum` (or `#[serde(untagged)]` when the TS union has no discriminant tag) |
| `Record<string, T>` | `HashMap<String, T>` — `BTreeMap` where key order is observable in JSON output |
| `Map<chatId, State>` manager field | `Arc<DashMap<String, Arc<Mutex<State>>>>` per the concurrency classes (§3.3) |
| `EventEmitter` | `tokio::sync::broadcast` for fan-out; explicit callback trait for a single sink |
| `Promise<T>` / `async` | `async fn(..) -> Result<T, DaemonError>`; TS `await` → `.await` 1:1 |
| `setTimeout` / `setInterval` | `tokio::time::sleep` / `interval` inside a named spawned task; store the `JoinHandle` for shutdown |
| `child_process.spawn` + NDJSON | `tokio::process::Command` + `BufReader::lines()`, `kill_on_drop(true)` |
| Zod schema | serde struct for shape + an explicit `validate()` fn for refinements; identifier rule `^[a-zA-Z0-9_-]+$` kept verbatim |
| `nanoid()` | `nanoid` crate (same alphabet + length) |
| `throw` / `try`/`catch` | `Result` + `?`; the `catch` block body becomes the `Err` arm — never drop an error the TS logged |
| `JSON.parse` on a DB column | `safe_json_array` helper (defensive) — never a bare `from_str` that propagates |
| TS `number` | `f64` where fractional (costs, ms timestamps); `i64` for counters/ids. Fixtures decide ambiguous cases (§4) |
| `Date.toISOString()` (a string field) | `mainframe_runtime::time::to_iso8601(dt)` / `now_iso8601()` — millis + `Z`, **never** `to_rfc3339()` (§4) |

### 3.2 Before / after snippets

**Discriminated union → tagged enum.** From `types/src/events.ts`:

```ts
export type DaemonEvent =
  | { type: 'connection.ready'; clientId: string }
  | { type: 'chat.created'; chat: Chat; source?: 'import' }
  | { type: 'chat.ended'; chatId: string }
  // ...
```

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum DaemonEvent {
    #[serde(rename = "connection.ready")]
    ConnectionReady { client_id: String },
    #[serde(rename = "chat.created")]
    ChatCreated {
        chat: Chat,
        #[serde(skip_serializing_if = "Option::is_none")]
        source: Option<ChatCreatedSource>, // enum { Import } -> "import"
    },
    #[serde(rename = "chat.ended")]
    ChatEnded { chat_id: String },
    // ...
}
```

The struct-level `#[serde(rename_all = "camelCase")]` handles `client_id` →
`clientId`; the variant `rename` handles the dotted `type` string. Verify each
variant against `fixtures/event.*.json`.

**Optional field with `skip_serializing_if`.** From `types/src/git.ts`:

```ts
interface BranchStatus { tracking?: string; ahead?: number; behind?: number; }
```

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchStatus {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tracking: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ahead: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub behind: Option<i64>,
}
```

If a fixture shows the field present as `null` (not omitted), drop
`skip_serializing_if` for that field and use `Option` with default — the fixture
is authoritative.

**EventEmitter → broadcast channel.** From `plugins/event-bus.ts` (daemon bus
fan-out):

```ts
export function emitPublicDaemonEvent(daemonBus: EventEmitter, event: PublicDaemonEvent): void {
  daemonBus.emit(`${PUBLIC_DAEMON_EVENT_PREFIX}${event.type}`, event);
}
```

```rust
// one broadcast::Sender is the daemon bus; subscribers filter by event.type()
pub fn emit_public_daemon_event(bus: &broadcast::Sender<PublicDaemonEvent>, event: PublicDaemonEvent) {
    // send() errors only when there are no receivers; that is not fatal here
    let _ = bus.send(event); // PERF(port): namespaced-channel prefix collapses into type-filtered receivers
}
```

A per-chat sink that had one consumer maps to `mpsc` instead of `broadcast`; use
the `SessionSink` trait (`mainframe-adapter-api`) to mirror the TS interface.

**`setInterval` cleanup → named task + JoinHandle.** From `chat/idle-scanner.ts`:

```ts
private timer: ReturnType<typeof setInterval> | null = null;
start() { this.timer = setInterval(() => this.scan(), INTERVAL_MS); }
stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
```

```rust
pub struct IdleScanner { handle: Option<JoinHandle<()>> }

impl IdleScanner {
    pub fn start(&mut self, state: Arc<ScannerState>) {
        let mut ticker = tokio::time::interval(INTERVAL);
        self.handle = Some(tokio::spawn(async move {
            loop {
                ticker.tick().await;
                state.scan().await;
            }
        }));
    }
    pub fn stop(&mut self) {
        if let Some(h) = self.handle.take() {
            h.abort(); // mirrors clearInterval; drop of the JoinHandle detaches
        }
    }
}
```

Every spawned timer stores its handle so ordered shutdown can `abort()` it.

**Zod `refine` → explicit validate fn.** From `server/ws-schemas.ts`:

```ts
z.object({ worktreePath: z.string().min(1).optional(), branchName: z.string().min(1).optional() })
  .refine((m) => (m.worktreePath == null) === (m.branchName == null),
    { message: 'worktreePath and branchName must be provided together' });
```

```rust
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateChatBody {
    pub worktree_path: Option<String>,
    pub branch_name: Option<String>,
}

impl CreateChatBody {
    pub fn validate(&self) -> Result<(), ValidationError> {
        if self.worktree_path.is_some() != self.branch_name.is_some() {
            return Err(ValidationError::new(
                "worktreePath and branchName must be provided together",
            ));
        }
        Ok(())
    }
}
```

serde handles shape/optionality; the refinement predicate and its **exact error
message** (it crosses the wire) become a `validate()` call the handler invokes
before doing work. Keep `.min(1)` as an explicit non-empty check.

**try/catch → Result with the catch body as the Err arm.** Never drop an error
the TS logged:

```ts
try {
  const result = await runGit(args);
  return result;
} catch (err) {
  logger.warn({ err }, 'git command failed');
  return { success: false, error: String(err) };
}
```

```rust
match run_git(&args).await {
    Ok(result) => Ok(result),
    Err(err) => {
        tracing::warn!(?err, "git command failed"); // same level + message
        Ok(GitResult { success: false, error: Some(err.to_string()) })
    }
}
```

The log level and text are copied verbatim (they may be asserted by tests and
they shape user-visible behavior). A silent `catch (err) {}` in TS still gets a
one-line log in Rust or an `/* expected */`-style comment explaining the silence.

### 3.3 Concurrency classes (use these — never invent locking locally)

JS is single-threaded; the port introduces shared-state concurrency. Every
long-lived mutable manager field has a pre-decided class. If a per-file
`CONCURRENCY.tsv` row exists for your field, it wins; otherwise apply the class
that matches:

- **`SINGLE_TASK`** — touched from one spawned task only → plain owned state in
  that task, no lock.
- **`SHARED_MAP`** — concurrent map keyed by id (chats, sessions, launches) →
  `Arc<DashMap<K, V>>` (default) or `Arc<RwLock<HashMap<K, V>>>`.
- **`PER_ENTITY`** — per-chat mutable state (queue, permission FIFO, plan-mode) →
  `Arc<Mutex<ChatState>>`, one lock per entity. **Never hold across an `.await`
  that emits events.** Lock ordering: the chat lock is a leaf — acquire the
  manager map first, clone/drop the `Arc`, release the map ref, then take the
  chat lock.
- **`BROADCAST`** — event fan-out → `broadcast::Sender`.
- **`DB`** — behind the `Db` handle (`spawn_blocking`).

Locking that does not match the assigned class is a forbidden pattern (§5).

---

## 4. Wire-parity rules

The wire contract is frozen. Consult `docs/rust-port/CONTRACT/` and
`docs/rust-port/fixtures/` for **every** shape you are unsure about — do not
guess field names, casing, or presence.

- **Serialize with `serde_json` defaults** (compact, no pretty). Field names are
  copied from the TS types verbatim; struct-level `#[serde(rename_all =
  "camelCase")]` reproduces the JS camelCase.
- **Response envelope** — one `respond` module:
  - `ok(data)` → `{"success":true,"data":<data>}`
  - `ok_empty()` → `{"success":true}`
  - `fail(status, error)` → `{"success":false,"error":"<message>"}`
- **Known deviations** (reproduce exactly; do **not** "fix" them — a port agent
  correcting these is a defect):
  - `DELETE /api/tags/:name` → bare `204`, no envelope.
  - `GET /health` → bare status object, not `{success,data}`.
  - `POST /api/projects` conflict → `409` carries a `data` payload **alongside**
    `success:false`.
  These are tagged `knownDeviations` in `CONTRACT/routes.json`.
- **WS events** — a bare JSON object with a `type` discriminator. Subscription
  semantics are identical: `connection.ready` is the first frame (carries
  `clientId`); on subscribe the server sends `subscribe:ack` + a
  `message.queued.snapshot`; events are chatId-scoped or broadcast exactly as the
  TS `WebSocketManager` decides. `CONTRACT/ws-events.json` records client→server
  schemas and server→client event shapes plus connection/subscription/broadcast
  semantics.
- **Numbers** — `f64` for fractional values (costs like `0.0842`, ms timestamps);
  `i64` for counters/token counts/ids. When a fixture shows `0` for a cost field,
  it is still `f64` (`0` and `0.0` serialize identically). Check the fixture's
  `full` variant for the widest observed value.
- **ISO-8601 string timestamps** — a field serialized from JS
  `Date.prototype.toISOString()` (e.g. event/chat `timestamp`, `createdAt`, the
  `/health` `timestamp`) is millisecond precision with a literal `Z`
  (`2026-07-08T10:15:30.000Z`). **Do not use `chrono::DateTime::to_rfc3339()`** —
  it emits microseconds and a `+00:00` offset (`…30.123456+00:00`), which is not
  byte-identical to Node. Use the shared helper
  `mainframe_runtime::time::to_iso8601(dt)` / `now_iso8601()` (it is
  `to_rfc3339_opts(SecondsFormat::Millis, true)`) for **every** timestamp-string
  field so the whole daemon matches Node. Numeric ms timestamps (an `f64`, not a
  string) follow the Numbers rule above, not this one.
- **Fixtures carry `minimal` and `full` variants** for events with optional
  fields (see `fixtures/event.chat-created.json`): `minimal` proves the
  omit-when-absent behavior, `full` proves every optional serializes correctly.
  `_provenance` (`synthetic` / captured) tags the source. Your golden round-trip
  test must deserialize→serialize **both** variants byte-stably (key order aside).
- **Strictness** — keep Zod semantics: tolerate unknown fields where the TS
  schema does, reject them where it uses `.strict()`. `CONTRACT/routes.json`
  records each schema's strictness; when in doubt, `#[serde(deny_unknown_fields)]`
  only if the TS schema was strict.
- **Unknown inbound external-protocol events** (Claude stream-json, Codex
  JSON-RPC) are logged loudly once per type and skipped — never a hard error.

---

## 5. Forbidden patterns

A mechanical verify gate greps for these; any hit rejects the file:

- `unsafe` — every crate carries `#![forbid(unsafe_code)]`.
- `todo!(`, `unimplemented!(` — use `// TODO(port): <reason>` + a graceful error
  path instead.
- `.unwrap()`, `.expect(` — outside `#[cfg(test)]` code and the binary's `main`
  boot path.
- `panic!(`, `assert!`-in-prod that can fire on user input.
- `static mut`, `lazy_static` — use `OnceLock` / `OnceCell` where a one-time init
  is genuinely needed.
- `anyhow` in a **library** crate — library errors are `thiserror` enums; only
  the binary crate may use `anyhow` at the top level.
- `std::thread::spawn` — tokio only (`tokio::spawn`, `spawn_blocking`).
- Locking that does not match the concurrency class assigned to the field (§3.3).
- New dependencies not in the §8 allowlist / the Cargo workspace
  `[workspace.dependencies]`.

Also required (not grep-enforced but reviewed): the `PORT STATUS` trailer (§6) on
every file; same log level + text as the TS source; same error strings (they
cross the wire).

---

## 6. PORT STATUS trailer

Every ported file ends with this trailer (a Rust line comment block):

```rust
// PORT STATUS: src/chat/permission-manager.ts (118 lines)
// confidence: high | medium | low
// todos: 0
// notes: <anything Phase B / reviewers must know>
```

- **Line 1** — the exact source path and its line count, so a reviewer can pull
  the pair.
- **confidence** — `high`: a faithful mechanical translation you are sure of;
  `medium`: correct control flow but an idiom or shape you could not fully verify
  against a fixture/test; `low`: structural translation with open questions —
  expect Phase B rework.
- **todos** — the count of `// TODO(port):` markers in the file (must match).
- **notes** — concurrency-class choices, dropped JS optimizations
  (`// PERF(port):`), fixture gaps, the display-vs-claude split decision (§2.5),
  the `lib/*` home decision (§2.15), or "external plugin path dropped" (§2.9).

---

## 7. Review protocol

A file is not `reviewed` until it passes **two independent adversarial reviews**:

1. **Fidelity review** — diffs the `.rs` against the `.ts` line-by-line: same
   control flow, same early returns, same log level + text, same error strings,
   same function order, same field order in serialized output. Confirms tests
   were ported assertion-for-assertion. Flags any simplification or "made
   idiomatic" change that reduces diffability.
2. **Safety/idiom review** — checks the forbidden-pattern list (§5), confirms the
   concurrency class matches §3.3 (no lock held across an event-emitting
   `.await`, correct lock ordering), verifies `skip_serializing_if` decisions
   against fixtures, and confirms `thiserror`/`Result` error handling with no
   dropped error the TS logged.

Both reviewers confirm the toolchain gates are green
(`cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`)
and the `PORT STATUS` trailer is present and accurate. Only then set the file's
Status to `reviewed` in §2.

---

## 8. Dependency allowlist

Use **only** these crates. The Cargo workspace `[workspace.dependencies]`
(defined by the scaffold task) is the runtime authority; if it and this list
disagree, the scaffold wins and this document is updated. **Need something not
listed? Put it in your task's blockers — do not add a dependency locally.**

The scaffold workspace carries only the crates the current phases need; the
`Status` column tracks each crate. `in workspace` = declared in
`[workspace.dependencies]` now, add it to your crate's `Cargo.toml` with
`{ workspace = true }`. `deferred` = planned for the cited phase and **not yet**
in the workspace — it is added to `[workspace.dependencies]` when that phase
starts (raise a blocker if you need it sooner; do not add it locally).

| Crate | Used for | Status |
|---|---|---|
| `tokio` (full) | async runtime, process, time, sync | in workspace |
| `axum` (0.8, `ws`) + `tower-http` (`cors`, `limit`) | HTTP server, CORS, 30mb body limit, WS upgrade | in workspace |
| `serde`, `serde_json` | wire types + JSON | in workspace |
| `rusqlite` (bundled) | SQLite storage | in workspace |
| `tracing`, `tracing-subscriber`, `tracing-appender` | logging (daily rotation, 7-day purge) | in workspace |
| `thiserror` | library error enums | in workspace |
| `hmac`, `sha2`, `hex` | auth tokens (HMAC-SHA256 + hex encoding) | in workspace |
| `rand` | auth-secret / random id generation | in workspace |
| `nanoid` | id generation (same alphabet/length) | in workspace |
| `dashmap` | `SHARED_MAP` concurrent maps | in workspace |
| `notify` | file watcher (verify vs `fs.watch` on macOS) | in workspace |
| `chrono` | timestamps + the ISO-8601 wire helper (§4) | in workspace |
| `dirs` | home-dir resolution (`os.homedir()` equivalent) | in workspace |
| `reqwest` (rustls-tls, json) | HTTP client: push delivery (Phase 2), workflow HTTP connector (Phase 5) | in workspace |
| `tempfile` | **dev-dependency only** — temp dirs/files in db/git/fs tests | in workspace |
| `anyhow` | **binary crate top level only** (verify gate exempts the `mainframe-daemon` crate, forbids it elsewhere) | in workspace |
| `serde_yaml` | workflow DSL | deferred → Phase 5 (`mainframe-workflows`) |
| `cron` | workflow schedule triggers | deferred → Phase 5 |
| `qrcode` | pairing QR | deferred → Phase 3 (`mainframe-server` auth/pairing) |
| `futures` | stream/select combinators | deferred (added with the first crate that needs it) |

**Open dependency decisions (blockers, not local calls):**

- **JSONata** — `jsonata-rs` maturity is evaluated when `mainframe-workflows`
  starts; fallback is porting the documented DSL-subset evaluator. Do not pick
  one file-locally.
- External binaries stay shell-outs (same args): `rg` (ripgrep),
  `cloudflared` (tunnel), the LSP servers, the title-generation CLI. No crate
  replaces these in v1.

---

*This file is the single source of porting rules. If it conflicts with a
per-file `CONCURRENCY.tsv` row, the TSV wins for that field. If it conflicts with
the committed Cargo workspace, the workspace wins for dependencies. Everything
else here is authoritative — do not re-litigate the crate map, type map, or wire
rules locally; raise a blocker instead.*

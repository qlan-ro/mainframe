# Daemon refactor baseline (`packages/core-rs`)

Read-only audit of the Rust daemon, October 2026. Goal: name the trendline the
iterative work took, show the evidence, and propose the refactors that bring
the workspace back to a baseline future work can build on.

Scope: all 20 crates (952 source files, ~194k lines including tests; ~109k
production lines once test-only files and `#[cfg(test)]` spans are excluded).
Method: eight parallel deep reads (one per crate family plus one workspace-wide
metrics pass), a token-level clone detector over every `.rs` file, `cargo
clippy --all-targets` with the pedantic length lints switched on, `cargo tree
-d`, and the repo's own `tools/verify-gate.sh`. Every headline claim below was
read in place; the defects in section 2 were re-verified independently.

---

## 1. The trendline in one paragraph

The port from Node was done file-by-file, and the workspace still has the shape
of that process rather than the shape of the system. Three things followed:

1. **Seams were added where the port needed them, not where the design does.**
   Every sub-manager got its own `*Deps` trait, every crate that could not see
   the SQLite handle got its own blocking bridge, every place that could not
   reach a lower crate got a private copy of the helper. Result: a 65-method
   god port, 18 `*Deps`/`*Port` traits declaring 204 methods (50+ method names
   appear in two or more of them), a 2,360-line composition file, and the same
   capability (settings get, project path, emit event, clock, process runner)
   declared as a trait 3 to 9 times.
2. **Layering was documented but not followed, and the workarounds were copies.**
   The "adapter-agnostic" display pipeline lives in `mainframe-adapter-claude`
   and is used for Codex and mock chats too; `mainframe-display`'s pipeline
   modules are comment-only stubs. Git routes import their path resolver from
   the LSP crate. GitHub DTOs are duplicated between automations and plugins
   because "plugins cannot depend on automations". A version parser exists four
   times, a base64 decoder twice, `now_ms()` 17 to 19 times.
3. **The rules that would have caught this were never wired up.**
   `clippy.toml` sets a 50-line function threshold, but the lint is never
   enabled, so it fires zero times today and 115 times in production code when
   switched on. The 300-line file rule is violated by 54 production files while
   23+ modules say in their first line that they exist only to dodge the cap.
   The verify gate checks the Node-era rules (unwrap, unsafe, anyhow) and none
   of the Rust-era ones (length, `Result<_, String>`, silent `let _ =`).

On top of that, 348 files end with a `// PORT STATUS` trailer (4,215 lines,
3.9% of production), 265 files open with "Ported from `packages/core/...`"
(a directory that no longer exists), and 537 comments cite `todo #NNN` tickets
and 11 of 13 referenced planning docs are missing. A newcomer reads a codebase
that describes a migration instead of a daemon.

What is **fine** and should stay: the crate graph is acyclic; `unsafe`, `anyhow`
and `unwrap` are genuinely absent from production code; `cargo fmt` and default
clippy are clean; `std::sync::Mutex` is used correctly and no guard is held
across an `.await`; the interpreter core in automations, the `Db` actor, the
registry in adapter-api, the LSP task hygiene and the ACP crate's purity are all
sound. The problem is the layer between those good pieces.

---

## 2. Defects found on the way (fix first, each is a one-PR bug fix)

These are not refactors. They were found because the duplication made the
inconsistency visible. Each was re-verified by reading the code.

| # | Defect | Evidence |
|---|---|---|
| D1 | **`config.json` `dataDir` splits state across two directories.** The DB and the log directory resolve only from `MAINFRAME_DATA_DIR`/home, while attachments, plugins and automations use the merged config value. | `mainframe-db/src/lib.rs:63-80` (`get_data_dir`, with a stale TODO saying runtime has not ported it; it has at `mainframe-runtime/src/config.rs:158`), `mainframe-runtime/src/logging.rs:49-57`, versus `mainframe-daemon/src/main.rs:134-138` which passes `config.data_dir` everywhere except `DatabaseManager::new`. |
| D2 | **`$name` variable substitution is dead inside `loop`, `retry` and `parallel` bodies.** The runtime name index only recurses into `if` and `repeat`; the engine falls back to an empty name map and renders the literal `$name`. Validation uses a different walker that does recurse, so the definition validates clean. No test covers it. | `mainframe-automations/src/tokens/variables.rs:260-276`, `src/engine/walk.rs:124-130`, versus `src/domain/validate.rs:298-353`. |
| D3 | **Forking an `acceptEdits` chat to a worktree drops its permission mode.** `format!("{m:?}").to_lowercase()` yields `"acceptedits"`; the DB parses with camelCase serde and `.ok()`s the failure to `None`. | `mainframe-chat/src/lifecycle_manager.rs:806-809`, `mainframe-db/src/chats.rs:129-133`, `mainframe-types/src/settings.rs:12-19`. |
| D4 | **`chat.created` and `chat.updated` carry different key sets for the same row.** `create()` seeds `mentions`/`process_state`/`transcript_missing`/`pinned` as `None` while `map_row()` always emits `Some(..)`; `create_fork` seeds `effort` differently again. Three hand-built 48-field literals drift. | `mainframe-db/src/chats.rs:276-365`, `:373-463`, `:914-987`. `side_chats.rs:55-57` already does insert-then-`get`, the correct pattern. |
| D5 | **Codex chats persist a bogus Claude transcript path.** The chat crate computes `~/.claude/projects/<encoded>/<id>.jsonl` for every adapter on init; Codex ignores the field. | `mainframe-chat/src/event_handler/sink_metadata.rs:131`, `event_handler.rs:43-67`, `mainframe-adapter-codex/src/adapter.rs:328-336`. |
| D6 | **`enable_worktree` strands a stopped chat if the transcript move fails**; its twin `attach_worktree` restarts the chat on the same failure. `enable_worktree` also bypasses the injected seam, so the failure path is untestable. | `mainframe-chat/src/config_manager.rs:437-463` versus `:541-565`. |
| D7 | **Discarding a chat leaks worktree-offer state.** Four teardown paths clear different subsets of the per-chat maps; `teardown_live_chat` never calls `worktree_offers.forget`. | `mainframe-chat/src/chat_manager/discard.rs:11-54` versus `lifecycle_api.rs:69-95`, `idle_offload.rs:114-123`. |
| D8 | **`tunnel_manager::stop_all` is synchronous and fire-and-forget**, so the daemon can exit before any `kill` child has spawned, leaving `cloudflared` alive. The LSP shutdown never escalates past SIGTERM. | `mainframe-launch/src/tunnel_manager.rs:505-532`, `:628-638`; `mainframe-lsp/src/lsp_manager.rs:388-445`. |
| D9 | **Out-of-band step failure on deadline does not emit `RunUpdated`** while the agent-settle copy of the same block does. | `mainframe-automations/src/engine/deadline.rs:96-121` versus `engine/agent_settle.rs:191-216`. |
| D10 | **15 `if let Ok(g) = x.lock()` sites silently drop the write on a poisoned lock** (the other 209 sites recover). | `mainframe-plugins/src/ui_context.rs:42,58,79`, `event_bus.rs:88`, `context.rs:220`, `mainframe-adapter-claude/src/external_session_cache.rs:49,62`, `external_sessions.rs:129,136`. |

---

## 3. Structural refactors, ranked by payoff

Each item: what is wrong, the evidence, the target shape, the risk. Layering
constraint used throughout (from `docs/ARCHITECTURE.md`): `types` → `runtime /
db / git / display / background-tasks / launch / lsp / automations /
adapter-api` → `services / plugins / adapters` → `chat` → `server` → `daemon`.
A shared helper lands in a crate every user already depends on.

### R1. Collapse the `*Deps` port layer in `mainframe-chat` and shrink `chat_deps.rs`

**Evidence.**
- `mainframe-chat/src/chat_manager/deps.rs:9-279`: `ChatManagerDeps`, 65 methods.
  Nine sibling traits re-declare subsets of it: `LifecycleManagerDeps` 25,
  `EventHandlerDeps` 26, `ConfigManagerDeps` 12, `ExternalSessionDeps` 12,
  `DegradedRecoveryDeps` 11, `PermissionHandlerDeps` 11, `WorktreeOfferDeps` 7,
  `TranscriptPresenceDeps` 7, `ResolveTuningDeps` 2. `emit_event` is declared
  in 9 traits, `chats_update` in 6, `projects_get_path` in 6, `settings_get`
  in 4; 50+ method names appear in two or more.
- `chat_manager/deps_{lifecycle,event,config,permission,recovery,offer}.rs`
  (795 lines) are forwarding shims: `fn chats_get(&self, id) { self.deps.chats_get(id) }`.
  Eleven structs carry the same `deps + active_chats + messages + permissions`
  bag; the registry type alias is defined four times.
- `mainframe-server/src/chat_deps.rs` (2,360 lines; 1,413 production, 947
  inline tests) implements `ChatManagerDeps`, `ExternalSessionDeps` and
  `ResolveTuningDeps` for one struct. About 35 of the 65 methods are
  `self.db.call_blocking(move |d| d.chats.X(..)).unwrap_or_default()`; the
  file has 61 `call_blocking` sites, the next-largest file has 7.
  `build_chat_manager` takes 14 parameters plus a dead `_resolved_path`.
  `ExternalSessionDeps` is half forwarders plus an `OnceLock<Weak<ChatManager>>`
  back-reference (`:206-209`) so the deps object can call the manager built from it.
- The in-crate test double `StoreDeps` is 570 lines; `FakeDeps` is defined in 7
  files; every fake re-implements 11 to 25 methods.
- The module doc at `chat_manager.rs:3-9` calls this "the Rust analogue of the
  TS closure bag".

**Target shape.**
1. One `Arc<ChatShared>` (`deps`, registry, message cache, permissions, queued
   refs) held by every sub-manager and wrapper. Delete the nine sub-traits and
   the six `deps_*.rs` shims; sub-managers read `shared.deps` directly.
2. Split `ChatManagerDeps` by capability: `ChatStore` (DB reads/writes),
   `ProjectPaths`, `SettingsReader`, `EventEmitter`, `Pusher`, `AdapterPort`,
   `WorkspacePort`. Compose with supertrait bounds. One shared fake per
   capability in `mainframe-chat/src/test_support/`.
3. Move the `Db` actor from `mainframe-server/src/db.rs` to `mainframe-db`
   (see R5) and let `mainframe-chat` depend on `mainframe-db` (tier 3 → tier 1,
   allowed). Then `impl ChatStore for Db` lives once, the five DTO translation
   functions at `chat_deps.rs:87-190` disappear, and `chat_deps.rs` keeps only
   the real adapters (`display_projector`, `send_push`, `on_provider_quota`,
   `kill_tasks_for_chat`, `scan_loaded_history`, `list_external_sessions`).
4. Split what remains into `mainframe-server/src/chat_deps/{mod,scan,external_sessions,bridges,tests}.rs`.
5. Make `ExternalSessionDeps: ChatManagerDeps` a supertrait with default
   forwarding and move the sweep's `reconcile_transcript` call to the manager,
   deleting the `Weak` back-reference.

**Risk.** Medium-high churn, mechanical. Do it one sub-manager at a time behind
the existing tests; the chat crate has 12.6k lines of them.

### R2. Make the display pipeline adapter-agnostic for real; grow the `Adapter` trait; delete adapter-id string dispatch

**Evidence.**
- `mainframe-display/src/display_pipeline.rs` and `display_helpers.rs` are
  comment-only stubs ("NOT ported into this crate. BLOCKER (crate layering)").
  The real pipeline (~2.9k lines: `messages/{display_pipeline, display_helpers,
  display_tool_groups, display_assistant, display_user, message_grouping,
  task_subject_backfill, incremental/*}`) lives in `mainframe-adapter-claude`
  and is wired for every adapter: `mainframe-server/src/chat_deps.rs:31,351`.
  `mainframe-chat/Cargo.toml:34` dev-depends on the Claude crate to test its
  own display path. Two of the modules already say in their headers that they
  belong in display (`message_grouping.rs:7-14`, `task_subject_backfill.rs:9-13`).
  The only Claude-specific inputs are `parse_ask_user_question` and the
  slash-command tag parser.
- Nine adapter-id string dispatch sites outside the registry:
  `mainframe-server/src/routes/skills.rs:62-80`, `routes/agents.rs:70-71`,
  `chat_deps.rs:1089,1099-1130`, `routes/chats.rs:523`, `routes/settings.rs:594`,
  `mainframe-chat/src/lifecycle_manager.rs:1126`, `config_manager.rs:453,540`,
  `mainframe-adapter-api/src/lib.rs:275`. The trait still says `// TODO(port):
  the optional skill/agent/command/external-session CRUD methods ... are
  deferred` (`adapter.rs:220-224`). `apply_codex_provider_tuning` is a no-op TODO.
- `main.rs:748-790` builds quota pullers and identity resolvers per adapter by
  hand with string ids.
- `mainframe-adapter-claude → mainframe-services` exists for one pure function
  (`todos::normalize::normalize_todos`, `assistant_event.rs:4`), which drags
  `mainframe-db` into the adapter's link graph. `mainframe-adapter-mock`
  depends on `mainframe-claude-workflows` and not on `mainframe-display`,
  contrary to the architecture doc.
- Codex keeps a byte-for-byte copy of `parse_unified_diff` behind a stale TODO
  (`mainframe-adapter-codex/src/unified_diff.rs:6-9`); the display version is
  complete and has zero consumers.

**Target shape.**
1. Move the pipeline into `mainframe-display`. Break the Claude dependency with
   a small `ToolResultDecoders` trait (ask-user-question decode, command-tag
   strip, command parse) with no-op defaults; each adapter returns its decoder
   from `Adapter::display_decoders()`. Delete the two stubs and the chat
   crate's dev-dependency on the Claude adapter.
2. Extend `Adapter` with defaulted capability objects: `skills() ->
   Option<Arc<dyn SkillsProvider>>`, `list_external_sessions(..)`,
   `read_tool_result(..)`, `relocate_transcript(..)`, `config_conflicts()`,
   `quota_source() -> Option<Arc<dyn QuotaSource>>`. Replace
   `has_probe_models/probe_models/list_models/get_fallback_models` with
   `catalog()` + `refresh_catalog()`. Delete `apply_codex_provider_tuning`.
   Then the nine string matches and the per-adapter wiring in `main.rs`
   become registry loops.
3. Move `todos::normalize` to `mainframe-types` (pure `Value → Vec<TodoItem>`),
   drop `adapter-claude → services`. Put the mock's workflow sink behind a
   trait in `mainframe-background-tasks` so it drops `claude-workflows`.
4. Delete `codex/unified_diff.rs`; import from display.
5. Keep `claude_session_id` out of generic code: rename to `vendor_session_id`
   in types (mechanical, separate PR), and store a transcript path only when
   the adapter reports one (fixes D5).

**Risk.** Medium-high for the pipeline move (large but mechanical; the
equivalence suite and golden tests travel with it). Medium for the trait
extension (route parity tests in server).

### R3. One process module: spawn, PATH, pumps, kill, run-with-capture

**Evidence.**
- Six independent `kill(1)` shell-outs plus Codex's SIGKILL-only
  `start_kill`, with seven different TERM→KILL ladders:
  `mainframe-launch/src/launch_manager.rs:748-773` (group then pid),
  `tunnel_manager.rs:628-638` (fire-and-forget on a spawned task),
  `process/sweep.rs:183-199` (synchronous `std::process::Command`),
  `mainframe-lsp/src/lsp_manager.rs:169-175` (TERM only),
  `mainframe-background-tasks/src/kill.rs:119-133` (`pgrep -P` recursion),
  `mainframe-adapter-claude/src/session_process.rs:72-87`,
  `mainframe-adapter-codex/src/jsonrpc.rs:357-372`. Eight comments justify
  this with "no libc/nix in house style", but `rustix` with the `process`
  feature is already a workspace dependency (`Cargo.toml:44`) and is used in
  `background-tasks/src/spool_root.rs:9`.
- PATH is threaded four ways: `ResolvedPath` by value; a process-global
  `OnceLock<String>` in `mainframe-background-tasks/src/spawn_env.rs:17` (the
  porting rules forbid this, and `chat_deps.rs:205` cites that rule as the
  reason for a different field); `Option<String>` builder setters in launch,
  tunnel and LSP registries; bare `&str` in the adapters. 14 sites apply it by hand.
- Byte-identical stdin writer tasks in `lsp_manager.rs:285-294`,
  `codex/jsonrpc.rs:157-166`, `claude/session_process.rs:108-116`. Twenty-line
  stderr ring buffers in `launch_manager.rs` and `jsonrpc.rs`. Exit watcher
  tasks in five places, exit latches in three, output pumps in four.
- Seven "run a command with timeout and capture" wrappers:
  `mainframe-git/src/git_exec.rs:49-120`,
  `mainframe-services/src/workspace/worktree.rs:30-57` (a **second
  `exec_git`** behind a TODO claiming the git crate "is still an empty
  placeholder"; it is 3k lines and services does not even depend on it),
  `background-tasks/src/lsof.rs:93-135`, `adapter-api/src/resolve_executable.rs:79-99`,
  `server/src/skills_cli/run.rs:45-90`, `automations/src/actions/shell.rs:22-70`,
  `launch/src/process/sweep.rs:132-166`. Two of them define the same
  `code: number | string` enum (`ExecCode`, `GitExecCode`).
- Command setup with the same PATH + `FORCE_COLOR=0` + `NO_COLOR=1` + piped
  stdio + `kill_on_drop` in seven adapter sites. Three "is this binary on PATH"
  probes (`sh -c command -v`, `which`, manual scan).
- `mainframe-launch` spawns 12 tasks and keeps zero `JoinHandle`s;
  `mainframe-lsp` does it right (`BridgeHandle` aborts on drop). 59 of 72
  production `tokio::spawn` calls workspace-wide drop the handle.
- `LaunchManager` and `TunnelManager` are the same supervisor written twice
  (`record_spawn`/`forget_spawn`, exit watcher, status broadcast); their
  `start` functions are 206 and 168 lines; tunnel errors are `Result<String, String>`.
- `ps`/`lsof`/`pgrep` output is hand-parsed twice each (`kill.rs` vs
  `sweep.rs`; `lsof.rs` vs `sweep.rs`).

**Target shape.** `mainframe-runtime::process` (runtime already owns
`ResolvedPath` and every spawning crate depends on it):

```rust
pub enum Signal { Term, Kill, Int }
pub enum Target { Pid(u32), Group(u32) }
pub fn signal(t: Target, s: Signal) -> io::Result<bool>;        // rustix; false = ESRCH
pub fn is_alive(pid: u32) -> bool;
pub async fn terminate(t: Target, grace: Duration, exited: impl Future<Output = ()>) -> Terminated;
pub async fn run_captured(cmd: Command, timeout: Option<Duration>) -> Result<Captured, ExecError>;
pub fn cli_command(exe: &str, path: &ResolvedPath) -> Command;   // env, no-color, piped, kill_on_drop
pub fn spawn_stdin_writer(stdin: ChildStdin) -> UnboundedSender<Vec<u8>>;
pub fn spawn_line_pump(reader, on_line) / spawn_chunk_pump(reader, on_chunk) -> JoinHandle<()>;
pub struct ExitLatch; pub struct TailBuffer;
pub struct ManagedProcess { pumps: Vec<JoinHandle<()>>, exit: JoinHandle<()>, cancel: CancellationToken, .. }
pub mod inspect { command_line(pid), cwd(pid), descendants(pid), writers_of(path) }
impl ResolvedPath { pub fn apply(&self, cmd: &mut Command); pub fn find(&self, name) -> Option<PathBuf> }
```

Delete `background-tasks/spawn_env.rs` (the global), the three `Option<String>`
PATH copies, the services `exec_git`, the duplicate `parse_version`s (see R6),
and replace the process-global `OnceLock<Mutex<KillSeam>>` test seams in
`kill.rs`/`lsof.rs` with the injected-struct style `sweep.rs` already uses.
`exec_git` becomes a 15-line adapter over `run_captured`; `tunnel_manager::stop_all`
becomes `async`.

**Risk.** Medium. Tests in `sweep.rs` and `kill.rs` assert on `kill` flag
strings and need re-pointing at the injected signal function; ESRCH semantics
must be chosen once. Keep `GitExecError.message` text (it is pattern-matched).

### R4. Server: one `ApiError`, one scope resolver, a non-optional `AppCtx`, a `Bootstrap`

**Evidence.**
- No `impl IntoResponse` for any error type in the workspace. 455 hand-built
  `StatusCode::` sites, `fail()` 286×, `internal_error()` 61×, 73 bare
  `INTERNAL_SERVER_ERROR` literals. The chat lookup three-arm match appears 10
  times (`routes/chats.rs:149,249,270,295,377,480`, `context.rs:34,64`,
  `chat_discard.rs:31`, `tunnel_ports.rs:58`), `"Chat not found"` 32×,
  `"Project not found"` 32×, and the status drifts (400 instead of 404 at
  `chat_create/mod.rs:101` and `tunnel_ports.rs:60`). Five chat error enums
  expose `status_code() -> u16` and the server converts back with
  `StatusCode::from_u16` at 7 sites.
- Six "effective path" resolvers with divergent missing-worktree semantics:
  `ctx.rs:177-208`, `routes/files.rs:49-72` and `:476-489`, `routes/git.rs:72-141`,
  `ws_file_watch.rs:142-148`, `routes/chat_workflow_runs.rs:19-41`, plus
  `ChatManager::get_effective_path`. The DB `worktree_missing` flag they branch
  on is never persisted (`mainframe-db/src/chats.rs:344,441,956` always write
  `None`), so three of the branches and the 409 arm in `files::resolve_path`
  are dead. Git routes additionally import `get_effective_path` from
  **`mainframe-lsp`** (12 call sites), which defines its own
  `ProjectStore`/`ChatStore` traits for it.
- `AppCtx` (`ctx.rs:94-168`): 24 fields, 8 of them `Option<Arc<..>>` that are
  always `Some` in production and `None` only for the route-unit harness. That
  produces 36 gates on `ctx.chat_manager` with five different fallback
  statuses and 24 "Phase-4 seam" warn strings in production logs. Ten fields
  are used by exactly one file. The `AppCtx { .. }` literal is written out at
  11 sites; `fn test_ctx` is defined four times, twice under the same name.
- `mainframe-daemon/src/main.rs:113-547`: `run_daemon` is one 434-line
  function with zero tests; `boot_routes_integration.rs` re-does the wiring by
  hand with different defaults. Production port impls are split between the
  server crate and the binary (`plugin_host_db.rs`, `quota_store.rs`,
  `github_issues_port.rs`, `RefreshDeps`, `ReconcileDb`, `SettingsWriter`,
  quota closures, `spawn_task_event_bridge`), so the binary depends on 16
  internal crates. `chat_seams.rs:20` imports a route module
  (`routes::files::effective_path_sync`) into composition glue.
- `routes/agents.rs` and `routes/skills.rs` are the same file (~200 shared
  lines). Four request-body parsers; the shared one lives in `routes/projects.rs`
  and is imported by 21 files. The identifier rule `^[a-zA-Z0-9_-]+$` is
  hand-rolled 10 times in server routes (15 workspace-wide). `websocket.rs`
  serialises every broadcast twice (`:566-582`) to read `type`/`chatId` and
  gates on a string list that can drift from the `DaemonEvent` enum; it also
  embeds a 200-line LSP bridge.

**Target shape.**
1. `respond::ApiError { NotFound, BadRequest, Conflict, Unavailable, Internal{context, source} }`
   with `IntoResponse` producing today's envelope bytes; `From<DbError>`,
   `From<ForkError>` etc.; `AppCtx::require_chat/require_project`; handlers
   use `?`. Zod-prose strings become constructors. Centralise "log on 5xx,
   nothing on 4xx" there.
2. `AppCtx::resolve_scope(project_id, chat_id) -> Result<ScopePath, ScopeError>`
   in `mainframe-services::workspace` (sync, over the DB) used by routes, the
   seam, the WS watcher and LSP. Decide once that "missing" is filesystem-checked.
   Delete the other five and the LSP-crate import.
3. Drop the `Option` on the eight always-present fields; group `AppCtx` by
   ownership (`core`, `chat`, `infra`, `services`); `AppCtx::builder()` with
   production and test defaults replaces the 11 literals; `test_ctx()` builds a
   real `ChatManager` (the helper already exists).
4. `mainframe-server/src/bootstrap.rs`: a staged builder whose stage order
   encodes the ordering constraints now expressed as comments, returning
   `Daemon { ctx, handles }` with `serve`, `post_bind`, `shutdown`. `main.rs`
   becomes args → logging → config → `Bootstrap` → serve. Move the daemon-side
   port impls into `mainframe-server/src/wiring/`; the binary keeps
   `server`, `runtime`, `types` and its CLI deps.
5. `impl DaemonEvent { chat_id(); is_connection_global() }` in types; split the
   LSP bridge out of `websocket.rs`; merge agents/skills into one
   `adapter_catalog.rs` router; `routes/body.rs` extractor; `mainframe_types::ids::is_safe_identifier`.

**Risk.** Medium. `ApiError` must keep envelope strings byte-identical (tests
pin them). The scope resolver unifies behaviour (some routes start 404-ing on a
deleted worktree), so decide deliberately.

### R5. Data layer: one SQLite actor, one row-mapping toolkit, a `Chat` row/wire split

**Evidence.**
- Three SQLite stores with three connection strategies and three migration
  runners: `mainframe-db/src/lib.rs:105`, `mainframe-plugins/src/db_context.rs:162`
  (documented as "a private clone of the `mainframe-server` `Db` seam"; its
  actor at `:42-78` is line-for-line `server/src/db.rs:31-67`),
  `mainframe-automations/src/store/db.rs:80-111`. Only automations sets
  `busy_timeout`; `todos.rs:796-845` checks columns with hand-parsed
  `PRAGMA table_info` and no `user_version`.
- No shared row/enum/JSON mapping in `mainframe-db`: one enum writer plus five
  readers via `serde_json::from_value(Value::String(..))`, five JSON-column
  parse styles in `chats.rs` alone (`:145`, `:684`, `:793`, `:989`, `:702`),
  `Device` and `Tag` literals written twice each, `CHAT_SELECT_FIELDS` aliasing
  19 columns to camelCase so `row.get("adapterId")` reads like TypeScript.
  `migrations()` is one 417-line function; 20 of its 30 entries are the same
  `add_column_if_missing` shape; no per-step transaction.
- `Chat` (48 fields) is simultaneously DB row, wire DTO and enrichment carrier,
  with two `#[serde(skip)]` row-only fields. The literal is hand-built in
  seven files (D4 is the consequence). `ChatUpdate` plus five more partial
  structs in the chat crate convert into each other by hand; the tuning
  quartet (`effort/fast/ultracode/adaptive_thinking` with `double_option`) is
  spelled four times.
- `todos.rs` (1,434 lines) stores its domain as `serde_json::Map` rows, enums
  as `const [&str; N]` with hand-rolled Zod (`parse_enum`), compares status as
  bare strings in 8 places in `todos_github`, and its `attachment_context.rs`
  re-implements `attachment_store.rs` (sanitize, base64) with a weaker
  traversal guard (`basename` vs `is_safe_segment`).
- `mainframe-db → mainframe-runtime` exists only for `now_iso8601`;
  `mainframe-services → mainframe-db` exists only for an unused
  `impl SettingsReader for DatabaseManager` and a zero-caller
  `backfill_worktree_relationships`.

**Target shape.**
1. `mainframe-db::{open_sqlite(path, opts), actor::SqliteActor<S>, migrate::{Migration, run_versioned, add_column_if_missing}}`.
   `Db = SqliteActor<DatabaseManager>` (server's `db.rs` becomes a re-export);
   plugins and automations use the same actor and runner. Table-drive the
   column adds; wrap each migration in a transaction.
2. `mainframe-db::sql_types::{SqlEnum<T>, JsonCol<T>, SqlBool, FromRow, query_all, query_opt}`;
   one corruption policy (warn + default). `Device::from_row`, `Tag::from_row`.
3. Split `ChatRow` (persisted columns) from `Chat` (wire = row + enrichment);
   `create`/`create_fork` insert then `get` through `map_row` (fixes D4);
   `ChatUpdate::into_assignments()` replaces the 132-line SET ladder; one
   `ChatPatch` in `mainframe-types` replaces the six partial structs;
   `#[serde(flatten)] tuning: SessionTuning` replaces the repeated quartet;
   `Chat::unpersisted(&NewChat)` replaces the fallback literals.
4. Type the todos plugin: `TodoStatus/TodoType/TodoPriority` enums with
   `snake_case` serde (wire unchanged), `Todo` with `FromRow`, serde bodies
   instead of hand Zod; split into `todos/{routes,repo,types,migrations}.rs`;
   implement `PluginAttachments` over the services `AttachmentStore`; replace
   both hand-rolled base64 decoders with the `base64` crate that is already in
   the workspace (`Cargo.toml:62`, used by `mainframe-acp/src/replay_batch.rs`).
5. Move `time.rs` to `mainframe-types` (drops `db → runtime`); delete the two
   dead services→db uses (drops `services → db`).

**Risk.** Low for the toolkit (12 DB test files cover it). Medium for the
row/wire split (`Chat` is used in 100+ files); do create-then-get first.

### R6. Shared micro-helpers that exist 2 to 19 times

All mechanical, all low risk, all verified by grep. Home in parentheses.

| Helper | Copies | Where | Home |
|---|---|---|---|
| `fn now_ms()` | 17 definitions, 8 crates (+`Utc::now()` 22, `SystemTime::now()` 15) | `chat` ×6, `adapter-claude` ×2, `background-tasks` ×2, `server` ×2, `daemon`, `launch`, `codex`, `claude-workflows` | `types::time` (with `Clock` trait; automations already has one) |
| Version-triple parser | 4 (3 byte-identical, 30 lines each) | `adapter-api/src/lib.rs:70`, `adapter-api/src/resolve_executable.rs:105`, `adapter-codex/src/adapter.rs:406`, `adapter-claude/src/adapter.rs:33` | `adapter_api::version::CliVersion` |
| Lenient base64 decode/encode | 2 + 2 | `services/attachment/attachment_store.rs:259`, `plugins/attachment_context.rs:199,232`, `server/routes/files.rs:731` | the `base64` crate |
| `is_within_base` / `resolve_and_validate_path` (security-critical) | 2 | `server/src/path_utils.rs:16,33`, `automations/src/actions/paths.rs:12,19` | `runtime::fs` |
| Identifier rule `^[A-Za-z0-9_-]+$` | 15 | 10 in server routes, `services/attachment_store.rs:8`, `plugins/security/manifest_validator.rs:123`, … | `types::ids::is_safe_identifier` |
| `double_option` deserializer | 4 | `types/chat.rs:19`, `server/routes/chat_commands.rs:30`, `routes/settings.rs:208`, `types/tool_call_timing.rs:45` | `types::serde_util` |
| Atomic tmp+rename write | 5 (three tmp-name schemes) | `automations/credentials/{mod,keyring_store}.rs`, `adapter-claude/trust_store.rs`, `chat/history_cache.rs`, `launch/process/child_registry.rs` | `runtime::fs::write_atomic` |
| Poisoned-lock recovery | 209 inline + 4 local helpers (+15 silent skips, D10) | workspace | `runtime::sync::LockRecover` (or `parking_lot`) |
| `BoxFuture` alias | 6 (twice in `mainframe-acp` alone) | `adapter-api`, `automations/engine`, `acp/resume.rs`, `acp/prompt.rs`, `launch/child_registry.rs`, `server/skills_cli` | `types::BoxFuture` |
| `reqwest::Client` construction | 17 sites, 7 crates, differing UA/timeout policies | `automations` ×4 (`actions/mod.rs:85` says nobody should build a bare client again), `daemon/cli` ×4, `push_service`, `tunnel_manager`, `cliproxy`, `skills_cli` | `runtime::http::client()` |
| Keyed mutex / single-flight map | 6 | `git/project_lock.rs` (grows forever), `automations/credentials/refreshing.rs`, `server/acp_ws/facade_conn.rs`, `lsp/lsp_manager.rs`, `adapter-api/lib.rs`, `chat/lifecycle_manager.rs` (five maps) | `runtime::sync::{KeyedMutex, SingleFlight}` |
| GitHub Issues DTOs + error enum | 2 (admitted at `plugins/github_port.rs:3-6`) + ~50 lines of identity mapping in `daemon/github_issues_port.rs:163-203` | `automations/github_issues_types.rs:12-55`, `plugins/github_port.rs:14-55` | new `mainframe-github` crate (client, device flow, DTOs, HTTP helpers; depends on types only) |
| ACP container index (`old_ids_for`, `update_container_index`, …) | 2 identical | `acp/revision_log/delta.rs:114-153`, `acp/session_state/containers.rs:111-150` | one `ContainerIndex` in `acp` |
| `parse_worktree_list` + `WorktreeEntry` | 2 identical, false cycle claim | `git/git_service.rs:875-908`, `services/workspace/worktree.rs:60-105` | `mainframe-git::git_parse` |
| `ResumeSnapshot`, `RequestId`, `SessionLike`→`AdapterSession` kill bridge | 2 / 2 / 3 | `acp/resume.rs:62` vs `chat/history.rs:9`; `codex/types.rs:20` vs `types/acp/jsonrpc.rs:15`; `chat_deps.rs:1204`, `routes/worktree.rs:330`, `routes/background_tasks.rs:36` | `types` |
| `get_last_assistant_text`, ellipsis truncate, Claude project-dir encoder, `is_uuid`, `cwd_belongs_to_project`, HMAC verify | 2 / 2 / 3 / 2 / 2 / 2 | chat vs `server/automations_deps/chat_port.rs:127`; `claude/transcript.rs:20`, `claude/external_session_paths.rs:32`, `services/session_files.rs:19`; claude vs codex; `automations/triggers/webhook.rs:37` vs `runtime/auth/token.rs:82` | `types`, `adapter_api::paths`, `claude::layout`, `runtime::auth` |

### R7. Settings: nine abstractions over one key-value read

**Evidence.** Read traits for `(category, key) -> Option<String>`:
`mainframe-db::SettingsRepository`, `services::SettingsReader`,
`services::QuotaSettingsStore`, `adapter-api::SettingsWriter`,
`plugins::PluginHostDb::settings_*`, `plugins::PluginConfig`, and four chat
`*Deps` traits. Their production impls are the same five-line `call_blocking`
bridge five times, each swallowing `DbError` with `.ok().flatten()`
(`server/chat_deps.rs:518,1054,1234`, `daemon/quota_store.rs:21`,
`daemon/plugin_host_db.rs:64`). Notification config is parsed twice
(`services/notifications/notification_config.rs:58` vs `routes/settings.rs:81`).
Defaults are duplicated: `GeneralConfig::default()` vs literal `"stable"` at
`routes/settings.rs:184` and literal enum lists at `:264,:489-501`.
`ProviderConfigUpdate` in types has zero references while the route defines an
identical `ProviderPatch`; `FIELDS: [&str; 12]` hand-mirrors `ProviderConfig`.
`QuotaSettingsStore` is synchronous "to mirror better-sqlite3", forcing
`call_blocking` from tokio tasks.

**Target shape.** One `SettingsKv { get, get_by_category, set, delete }` trait
in `mainframe-types` (or db), implemented once by `Db`; the other eight become
aliases or `&dyn SettingsKv` parameters; make it async now that every caller is.
Move notification parsing into services; emit the GET body by serialising
`GeneralConfig`; validate enums by deserialising them; use or delete
`ProviderConfigUpdate`; derive `FIELDS` from the struct. Risk: low.

### R8. Automations: one step walker, one action manifest, one HTTP helper, one settle

**Evidence.** Seven hand-rolled recursive walkers over the `Step` tree with
their own notion of "children" (one incomplete, D2). Three to four sources of
truth per action: runtime manifest outputs, the frozen `domain/catalog.rs`,
hand JSON schema plus serde struct plus editor field list, `has_output_as`
bool **and** `ACTIONS_WITH_OUTPUT_AS` const, `ActionOutputType` vs
`TokenType`. HTTP connector scaffolding repeated per action (nine `.send()`
sites, `ERROR_BODY_SNIPPET_CHARS` ×3, four client builders with two fallback
policies). Out-of-band settle written three times (D9). `CheckpointStep.kind`
is a `String` matched by literal in six places although `Step::kind_name()`
exists. `domain`/`store`/`interactions` import from `engine` (25 sites).
Row-mapping quintuplet copied per table. 180 of 302 `pub` items have zero
external references; two facade methods are dead.

**Target shape.** `Step::child_bodies()` + `scope_rule()` and one
`walk_scoped` used by validation, name index, break checking and ancestry;
`ActionManifest` as the single source (derive catalog, delete the const,
generate schema from fields); `actions/http.rs::send_json`; `checkpoint::settle`
+ `Interpreter::settle_out_of_band`; `AutomationStepKind` enum in types;
checkpoint mutation as methods on `AutomationCheckpoint`; `pub(crate)` by
default; `src/testkit/` behind a feature for the 5 `FakeClock`s, 5
`FakeNotifier`s, 5 `FakeAgentPort`s and 4 `FixedProjects`. Risk: medium only
for the settle unification (the concurrent settle/cancel tests are the net).

### R9. Delete speculative abstractions and dead code

| Item | Evidence |
|---|---|
| Four plugin capability traits with zero callers (`PluginConfig`, `PluginEventBus`, `ProjectService`, `AdapterRegistrar`, the last with no impl anywhere), their guards, and `security/manifest_validator.rs` (322 lines, no callers) | `mainframe-plugins/src/context.rs:82-184`, `event_bus.rs:166-168` ("No builtin uses the bus yet"), `builtin_plugins.rs:67-83` registers claude/codex as phantom plugins |
| `mainframe-types/src/api.rs` (112 lines, 0 refs), `workflow.rs` (223 lines, 14 types) and the five `workflow.*` `DaemonEvent` variants with **no emitter in any crate** (54 Rust event tags vs 49 TypeScript), `ChatEffort` alias, `SYNTHETIC_TAG_*` consts, `ProviderConfigUpdate`, unused `chrono` dep | grep across workspace |
| Dead `pub` fns: `fs_utils::list_project_files`, `auth::reset_auth_state`, `chat_seams::default_*_stopper`, chat `get_project_path`/`get_chat_project_id`/`list_all_chats`/`is_chat_running`/`current_overlay_message`, db `connection()`/`update_last_opened`, automations `get_interaction`/`latest_webhook_sample`, `git/src/exec_git.rs` (15-line re-export shim named after a deleted TS file), `lsp::parse_lsp_upgrade_path`, `services::backfill_worktree_relationships`, `TodoSource::{TodoV1, CodexTodoList}`, `TaskV2Event` | each verified with zero callers outside its own crate/tests |
| `pub` by default: unreferenced-outside-crate items are 64% in adapter-claude (136/212), 39% in chat, 38% in launch, 30% in services | flip to `pub(crate)`; the compiler then finds the rest |
| Unused dependencies: `serde` ×4 crates, `thiserror` ×3, `dirs`, `dashmap`, `chrono`, `mainframe-display` in codex (comments only); workspace `anyhow` and `tokio-util` used by nobody; 21 duplicated crate versions (`notify` 6 pins `mio` 0.8 and `bitflags` 1; `rand` 0.8/0.9/0.10) | `cargo tree -d`, grep |

### R10. Comment residue and documentation

- Strip every `// PORT STATUS` trailer (348 files, 4,215 lines) and `//! Ported
  from packages/core/...` header (265 files). Rewrite the ~20 load-bearing
  "mirrors Node" notes (automations error strings the UI matches on) as "wire
  contract: UI matches this string". Drop `todo #NNN`, `T9`, `Phase 4`,
  `Decision 42`, `fact 12` references (813 lines) or replace with a path that
  exists. 11 of 13 cited planning docs are absent from the repository,
  including one cited 70 times: `docs/plans/` is gitignored (`.gitignore:53`),
  so every comment that points there is a dangling pointer for anyone but the
  original author's machine. Either track the docs that code cites or stop
  citing them.
- Fix the statements that are now false in exactly the files a newcomer reads
  first: `routes/mod.rs:4` ("12 route modules below are EMPTY stubs"),
  `ctx.rs:4,117,220`, `chat_seams.rs:1-5,27`, `http.rs:54`, `main.rs:3`,
  `db/lib.rs:5-6,62-65`, `services/lib.rs:26-27`, `worktree.rs:27-29`,
  `migrations.rs:559-563` (says 25 migrations; `LATEST_VERSION` is 30),
  `git_service.rs:875-883` (false cycle claim), `lsp` "WS mount deferred",
  `claude/lib.rs:11-13` ("empty skeleton"), the eight "no libc/nix" notes.
- `docs/ARCHITECTURE.md`: says 19 crates and omits `mainframe-acp`; the adapter
  tier line does not match `Cargo.toml`; "IncrementalProjector for Claude
  chats" is false. Regenerate the tier diagram from the manifests.

### R11. One error convention

Today errors cross crate boundaries five ways: 36 thiserror enums (good), 85
production `Result<_, String>` signatures including `pub trait` boundaries
(`chat_manager/deps.rs:36,55,228,278`, the whole `KeyringBackend` trait,
`TreeKillFuture`), 28 `map_err(|e| e.to_string())`, HTTP status smuggled as
`u16` through five chat enums, and `Response` used as the error type in ten
server functions (hence the crate-level `allow(result_large_err)`). Four chat
enums and `DbError`, `AttachmentError`, `PluginError` carry a `Message(String)`
catch-all used for not-found, invalid input, invariant violations and worker
death alike, so the server maps every `DbError` to 500. `AdapterError` has
only `Message` and `Io`; `ActionError`, `AgentPortError`, `NotifyError` are
newtype strings.

Convention: library crates expose thiserror enums only, with structured
variants (`NotFound{entity,id}`, `Invalid`, `Conflict`, `Worker`, `Timeout`,
`Spawn`, `Protocol`); an `HttpStatus` trait in types replaces the `u16`
methods; `ApiError` (R4) owns the mapping; `Display` text is preserved where it
crosses the wire. Add "no `Result<_, String>` in `pub` signatures" to the gate.

### R12. Test architecture

- Shared doubles have no home: `RecordingSink` in 10 files, `NoopQuotaSettings`
  9, `FakeDeps` 7, `RecordingSurface` 5, `FakeClock` 4, `impl AdapterSession`
  stubs in 9 files (~1.6k lines), `impl SessionSink` in 23 (~1.9k lines), the
  `AppCtx` literal in 11, `read()`/`body_json()` in 23 route tests, `get_json`
  ×7 / `run_git` ×6 / `init_repo` ×5 in integration tests, two 105-line
  identical `support.rs` files for Claude and Codex presentation streaming.
  The `mainframe-runtime` `test-support` feature holds one 88-line `LogCapture`.
  Clone detector: 497 test clone pairs, ~9.6k duplicated lines.
- 69 sleep-based tests (automations 21, server 16, mock 8); only 5 files use
  paused time. Two chat suites assert on log strings.
- Three test layouts coexist (235 inline `mod tests`, 129 `*_tests.rs`, 54
  `tests.rs`, 219 files in 24 `tests/` dirs, 11 nested under `src/`); the ten
  largest files are 41-68% inline tests, which is how 300-line files became
  1,400-line files.

Target: `test-support` features per tier (`adapter-api`: `NullSink`,
`RecordingSink`, `FakeSession`, `forward_session_sink!` macro; `services`:
`NoopQuotaSettings`; `chat`: capability fakes, `ChatBuilder`; `server`:
`AppCtx::test_builder()`, `read_json`; `automations`: `testkit`); one layout
(`foo_tests.rs` beside `foo.rs`, crate `tests/` for integration);
`start_paused` + handshakes instead of sleeps; gate `sleep(` in test files.

### R13. Enforcement, so the baseline holds

1. `[workspace.lints.clippy] too_many_lines = "warn"` (deny in CI) with
   `#[expect(reason)]` for the genuine tables; a file-length rule in
   `verify_gate.py` with a checked-in ratchet count that can only go down.
2. Gate additions: `Result<_, String>` in `pub` signatures; `let _ =` on a
   non-`send(` call without `/* expected */` or a `warn!` (69 silent discards
   today, one marker workspace-wide); `println!` outside the binary; `PORT
   STATUS` / `packages/core/`; `module =` and `target:` logging fields; missing
   `#![forbid(unsafe_code)]` (`mainframe-claude-workflows` lacks it).
3. Logging convention (10 lines): snake_case fields, `error = %err` for Display
   and `?err` for Debug (seven spellings today), always `chat_id`, no
   hand-baked message prefixes (72 today), module path as target, one
   `info_span!("adapter_session", adapter, session_id)` per session.
4. Pin the toolchain (`rust-version`, `channel = "1.97"`); `server/src/lib.rs:7-10`
   already blames the floating channel for lint drift.
5. Parameter structs for the 17 `too_many_arguments` allows; delete the 5
   `dead_code` allows; convert remaining `allow` → `expect(reason)`.

---

## 4. Sequencing

Ordered so each step removes code the next one would otherwise have to touch.
Sizes are rough and assume one PR each unless noted.

| Phase | Work | Depends on | Size |
|---|---|---|---|
| 0 | Defects D1-D10, each its own PR with a regression test | — | small ×10 |
| 1 | R13.1-2 enforcement switched on in **warn** mode with ratchets; R10 comment purge; R9 dead code and unused deps; `pub(crate)` flip | — | 3-4 PRs, large diff, zero behaviour change |
| 2 | R6 micro-helpers (types `time`/`ids`/`serde_util`/`BoxFuture`; runtime `fs`/`sync`/`http`; `CliVersion`; `base64`; `mainframe-github` crate) | 1 | 4-6 PRs |
| 3 | R3 process module, then migrate launch, tunnel, LSP, background-tasks, adapters, git onto it; delete the PATH global and the services `exec_git` | 2 | 1 foundation PR + 6 migration PRs |
| 4 | R5 data layer: actor + toolkit + migrations shared; `Chat` create-then-get; `ChatPatch`; `Db` moves to `mainframe-db` | 2 | 4 PRs |
| 5 | R7 settings; R11 error enums in db/chat/adapter-api/automations | 4 | 3-4 PRs |
| 6 | R4 server: `ApiError`, scope resolver, non-optional `AppCtx`, body/query extractors, agents+skills merge, `Bootstrap`, daemon port impls into `wiring/` | 4, 5 | 5-6 PRs |
| 7 | R1 chat: `ChatShared`, capability traits, delete sub-traits and shims, `chat_deps.rs` split, teardown/single-flight/history helpers | 4, 6 | 6-8 PRs, one per sub-manager |
| 8 | R2 display move + `ToolResultDecoders`; `Adapter` capability methods; delete string dispatch; mock typed fixtures; `vendor_session_id` rename | 7 | 4-5 PRs |
| 9 | R8 automations internals; R12 testkits and sleep removal; R13 flip warn → deny | any | ongoing |

Phases 1-2 are safe to start immediately and make every later diff smaller.
Phases 3-5 can run in parallel with each other. Phases 6-8 touch the hot path
and should be serialised.

---

## 5. Per-crate scorecard

Production lines exclude test-only files and `#[cfg(test)]` spans. "fns>50"
is clippy `too_many_lines` at threshold 50 on production code. "f>300" counts
files over 300 production lines / raw lines.

| crate | prod / test lines | f>300 prod/raw | fns>50 | prod `#[allow]` | `Result<_,String>` | `Value` fields | notable |
|---|---|---|---|---|---|---|---|
| server | 20,386 / 25,736 | 12 / 32 | 28 | 10 + crate-level | 25 | 1 | `chat_deps.rs` 2,360; 455 `StatusCode::` sites; 36 `chat_manager` gates |
| adapter-claude | 13,718 / 12,397 | 6 / 17 | 11 | 0 | 1 | 4 | 0 serde structs, 351 raw `.get("…")` chains; 34 `#[path]` splices; 64% unreferenced `pub` |
| chat | 13,274 / 15,467 | 5 / 14 | 22 | 2 | 9 | 3 | 65-method port + 9 sub-traits; 328 `.lock()`; 22 hand-written update+emit sequences |
| automations | 13,193 / 16,113 | 2 / 12 | 12 | 1 | 9 | 6 | 7 step walkers; 91/91 files with PORT STATUS trailers; 180/302 `pub` unreferenced |
| adapter-codex | 10,472 / 10,727 | 4 / 13 | 10 | 2 | 0 | 17 | 91 serde structs (the model to copy); `jsonrpc.rs::with_timeout` 173 lines |
| plugins | 6,024 / 6,006 | 3 / 5 | 15 | 2 | 3 | 0 | `todos.rs` 1,434; 4 capability traits with 0 callers; twin DB actor |
| types | 5,674 / 3,151 | 4 / 8 | 1 | 0 | 3 | 39 | `api.rs` and `workflow.rs` dead; 5 orphan events; 3 timestamp representations |
| acp | 4,312 / 6,849 | 1 / 5 | 1 | 3 | 2 | 5 | clean layering; two `BoxFuture` aliases in one crate; duplicated container index |
| launch | 3,124 / 2,822 | 4 / 5 | 5 | 1 | 9 | 0 | two supervisors; 12 spawns, 0 handles; `start` 206 and 168 lines |
| services | 2,754 / 2,925 | 2 / 8 | 4 | 1 | 2 | 3 | junk drawer; `normalize.rs` used by one adapter arm; second `exec_git` |
| db | 2,541 / 2,598 | 2 / 4 | 8 | 0 | 1 | 0 | `migrations()` 417 lines; three 48-field `Chat` literals; no row toolkit |
| adapter-api | 2,197 / 1,668 | 1 / 4 | 4 | 0 | 0 | 0 | registry sound; two runner traits; `parse_version` twice in the same crate |
| daemon | 2,192 / 1,097 | 1 / 1 | 5 | 2 | 12 | 0 | `run_daemon` 434 lines, 0 tests; 16 internal deps; port impls in the binary |
| background-tasks | 1,850 / 2,279 | 2 / 5 | 4 | 0 | 5 | 0 | PATH global; process-global test seams; kill orchestration duplicated in-file |
| git | 1,680 / 1,414 | 2 / 2 | 6 | 0 | 0 | 0 | `update_all` 114, `branches` 113 (2 git processes per branch); `parse_worktree_list` copied |
| adapter-mock | 1,530 / 1,169 | 0 / 1 | 2 | 0 | 4 | 1 | honest trait impl; stringly fixture dispatch; wrong deps |
| lsp | 1,347 / 869 | 2 / 3 | 2 | 0 | 0 | 1 | best task hygiene in the workspace; exports the git routes' path resolver |
| display | 1,274 / 1,566 | 1 / 1 | 0 | 0 | 0 | 8 | pipeline modules are stubs; `tool_grouping.rs` 492 logic / 1,073 test |
| runtime | 935 / 451 | 0 / 1 | 0 | 0 | 0 | 0 | clean; `test-support` = one helper |
| claude-workflows | 768 / 1,037 | 0 / 1 | 0 | 0 | 0 | 0 | small, cohesive; missing `forbid(unsafe_code)` |
| **total** | **109,245 / 116,341** | **54 / 142** | **115** | **22** | **85** | **88** | |

Clone detector (10-line normalised windows, string literals and numbers
folded, low-diversity windows dropped): 240 production clone pairs (~3.4k
lines), 497 test clone pairs (~9.6k lines).

---

## 6. What is fine (do not "fix")

- The crate graph is acyclic; `#![forbid(unsafe_code)]` on 19/20 crates; no
  `unsafe`, `anyhow`, `Box<dyn Error>`, `unwrap`/`expect`/`panic!` in
  production; `cargo fmt` and default clippy clean; the verify gate uses a real
  lexer and passes.
- `std::sync::Mutex` chosen correctly (143 files) with `tokio::sync::Mutex`
  only where needed (12); every sampled guard-across-await candidate is scoped.
  Lock order in chat is consistent; `join_flight` handles the lost-wakeup case
  and is tested.
- The `Db` actor itself; `ProjectsRepository` as the repository template;
  `side_chats.rs` insert-then-get; the versioned migration runner and its
  legacy-DB upgrade test; golden fixture tests in types.
- The automations interpreter core (`advance`, `walk`, `checkpoint`,
  `blocks_concurrent*`), its transactional store, its canonical wire types in
  `mainframe-types`, its validation messages, and its credential-store
  selection. `automations_deps/` in server is the composition pattern the chat
  side should copy; the automations route family already shares
  `engine()/unavailable()`.
- `AdapterRegistry` (single-flight refresh, snapshot-before-emit, version
  hook); `pr_detection` and `plan_mode_actions` correctly relocated into
  adapter-api; Codex's typed `event_mapper` decode; Claude's
  `ControlRequestChannel`; the mock adapter spawns nothing and implements the
  trait honestly.
- `mainframe-acp` purity and layering; `mainframe-lsp` task hygiene
  (`BridgeHandle`, `idle_timer`); `FileChildRegistry` + `sweep_stray_children`
  shape; the `clean_env` allowlist; `git_exec.rs` as a primitive;
  `git_parse.rs` parsers; one `notify` user; `BackgroundTaskTracker`.
- `respond.rs`/`async_err.rs`, the middleware stack and `http.rs` mount table
  in server; `chat_recovery.rs` (action enum + one `run`) as the route pattern
  to generalise; `chat_seams.rs` Noop/Registry pattern for optional services.
- Structured `tracing` fields are used in 431 of 549 production log calls; no
  `println!` outside the CLI subcommands.
- Test volume is high (1.06 test lines per production line); the problem is
  duplication and layout, not coverage.

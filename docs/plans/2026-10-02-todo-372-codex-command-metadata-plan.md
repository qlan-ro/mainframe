# Preserve Codex command metadata

Approved todo #372, size:m, no separate spec. Base commit `0ea3eb85d956abb2e126561970ee54337a8f918e`, branch `todo/372-codex-command-metadata`.

## Outcome and scope

Preserve Codex's parsed command actions and exact reported duration through live completion, restored history, ACP, and the UI tool-call projection. Existing Bash names, arguments, results, error flags, grouping, and visible lifecycle stay unchanged. No compact presentation, inferred actions, generic timing, timestamp synthesis, new endpoint, executable-selection changes, mobile changes, or retired Node daemon work.

The approved brief is the lane's external `brief.md`. The caller owns independent plan review, QA, and delivery gates. This plan defines one implementation group and its verification. Do not start another review loop inside that group.

## Established facts

- **F1, installed protocol.** `/opt/homebrew/bin/codex --version` reports `codex-cli 0.155.1`. Its generated v2 `CommandAction` has `read { command, name, path }`, `listFiles { command, path }`, `search { command, query, path }`, and `unknown { command }`. Search query/path and listFiles path are nullable. `ThreadItem.commandExecution` has `commandActions`, nullable `durationMs`, and nullable `aggregatedOutput`. JSON Schema declares duration as nullable `int64` milliseconds. Missing fields remain compatibility inputs even where this version requires them.
- **F2, loss at ingestion.** `packages/core-rs/crates/mainframe-adapter-codex/src/thread_item_variants.rs::CommandExecutionItem` omits actions/duration and requires a string output. `event_mapper.rs::handle_item_started` currently ignores commands. `thread_item_render.rs::render_command_execution` emits Bash plus a result only at completion. `history_convert.rs::convert_thread_items` builds the same command-only Bash block.
- **F3, restore sources.** `history_load.rs::load_history_inner` reads v2 items with `thread/read` and converts them through `convert_thread_items`. Child history can instead use `rollout_reader.rs::read_rollout_items`. `rollout_reconstruct.rs::handle_function_call_output` and `rollout_unified_exec.rs` synthesize command items from older records that do not supply this metadata. These constructors must use absent metadata, never inferred values.
- **F4, shared display path.** `mainframe-types/src/chat.rs::MessageContentNode::ToolUse` becomes `mainframe-types/src/display.rs::DisplayNode::ToolCall` through `mainframe-adapter-claude/src/messages/display_helpers.rs::convert_assistant_content`. That helper also rebuilds calls in `apply_tool_grouping`, `convert_grouped_parts_to_display`, and `convert_task_child`. The similarly named `mainframe-display/src/display_helpers.rs` is a placeholder, not the implementation.
- **F5, transport.** `mainframe-acp/src/encoder.rs::tool_call_item` creates `EncodedItem::ToolCall` and namespaced `ItemMeta`. `session_state/tool_patch.rs::tool_call_patch` replaces changed `_meta` as a whole. Matching contracts are `mainframe-types/src/acp/extensions.rs::ItemMeta` and `packages/types/src/acp/extensions-payload.ts::ItemMetaSchema`.
- **F6, UI.** `packages/ui/src/features/chat/view-model/acp-item-accumulator.ts::applyToolCallUpdate` preserves omitted `_meta` and replaces supplied `_meta`; `parse-item-meta.ts::parseItemMeta` validates extension fields; `convert-acp-item.ts::toolPart` currently forwards only arguments, result, error, identity, and nested messages. Installed `@assistant-ui/core@0.3.12` declares `ToolCallMessagePart.providerMetadata`, exposed through installed `@assistant-ui/react@0.15.13`.
- **F7, identity and lifecycle.** Codex `history.rs::vendor_metadata` and `tool_use_block` use the provider item id. `mainframe-chat/src/message_cache.rs::append` appends messages; the display grouping deduplicates tool ids. Adding a second visible emission at command start would require a lifecycle change and could discard the later block. This plan therefore keeps start metadata internal and emits the current terminal-only Bash pair.

F1 evidence is external to git at `.worktrees/.lane-state/todo-372-codex-command-metadata/`: `schema-version.txt`, `schema/v2/CommandAction.ts`, `schema/v2/ThreadItem.ts`, and `schema-json/v2/ItemCompletedNotification.json`. Generated with `codex app-server generate-ts --out <external-dir>` and `generate-json-schema --out <external-dir>`. This establishes the installed schema, not a captured provider execution.

## Contract and decisions

1. Define shared typed `CommandAction` and `CommandExecutionMetadata` contracts in small dedicated Rust and TypeScript modules. Add optional `commandExecution` to transcript ToolUse, display ToolCall, and ACP `ItemMeta`. Its members are `commandActions` and `reportedDurationMs`. The adapter maps provider `durationMs` to `reportedDurationMs` once. In the UI, expose that object through `part.providerMetadata.codex`, using the native part contract and a small typed reader if needed by callers.
2. Known actions retain their discriminant and supplied command/name/path/query values in provider order. Nullable optional action fields accept both missing and null. Preserve an empty array as an empty array. An explicit unknown action retains its command. An unfamiliar action variant normalizes to an unknown action, retaining an available command; it must never become read/search/listFiles or reject the enclosing item. A malformed optional action must not erase the Bash command. Define the fallback in one deserializer and mirror its normalized output in Zod.
3. Absent/null actions or duration mean unavailable. Omit unavailable metadata members on output; omit `commandExecution` if neither member is available. Zero duration is present. Use the provider integer milliseconds unchanged, with no rounding, unit conversion, falsy checks, or wall-clock replacement. Rust uses `Option<i64>` and TypeScript accepts integer JSON numbers. No new epoch or `startedAt`/`completedAt` fields. This naming explicitly separates provider-reported execution duration from future #373 daemon timestamps.
4. Cache start metadata by provider thread and item identity after the existing owner-routing check. Do not emit a Bash block or result from `item/started`. Completion overlays supplied metadata on the cached value, so omitted/null completion actions retain prior actions, while explicit `[]` replaces them. Completion-only events remain supported. Remove consumed state on completion. Clear abandoned entries on owning-thread turn completion, cancellation, and session reset, including child threads. A new start for a reused identity replaces the previous cached entry rather than inheriting it; turn ownership must prevent a late event from reusing stale state. Keep this state local to the Codex session; no persistence or global registry.
5. Normalize missing/null `aggregatedOutput` to the existing empty-string result at the adapter boundary so schema-valid start/completion records remain usable. Preserve every nonempty output exactly and retain existing `is_exec_error` behavior.
6. Use one command-to-tool-block helper in live completion and `convert_thread_items`, so the same terminal item produces equivalent metadata and tool identity. Keep provider execution input exactly `{ command }`. Carry metadata through parent-id tagging and all display reconstructions, including grouped and nested calls. Prefer existing source-call lookup in display grouping over widening unrelated grouping records solely for this payload.
7. The ACP encoder emits a complete current `ItemMeta` when metadata changes. A duration-only logical change must still include retained actions and existing container/group/parent fields in the replacement `_meta`. Keep the generic ACP replacement grammar and UI accumulator semantics unchanged. Cover a same-id snapshot transition with actions first, then actions plus duration, without adding a new live command-start presentation.
8. Restore parity means equivalent metadata for equivalent provider records. Older rollout records without provider metadata remain absent. Do not parse approximate durations from textual output or infer actions from commands. Reload cannot reconstruct metadata the provider never persisted; report that boundary if a live sparse completion is absent from the final `thread/read` record.
9. Unknown and mixed action arrays remain available as data. No action classifier, compact summary, or altered grouping ships in this task. Existing ordinary Bash presentation remains the fallback for all arrays.

## Task group G1

**Kind:** core-dev. **Dependencies:** none. **Owner:** one implementation worker for the complete path and its regression tests. Do not split failing tests from implementation. The UI changes are pure projection, without markup or styling.

### Owned files

Paths below are relative to the repository root. Use neighboring small modules when an existing file exceeds the repository size limits. Keep mechanical constructor updates narrow.

| Area | Files and responsibility |
| --- | --- |
| Shared contracts | New `packages/core-rs/crates/mainframe-types/src/command_execution.rs` and `packages/types/src/command-execution.ts`; exports in Rust `lib.rs` and TS `index.ts`; Rust/TS `chat` and `display` modules; Rust `acp/extensions.rs` and TS `acp/extensions-payload.ts` plus ACP exports. Define metadata once per language and reference it. |
| Codex | `packages/core-rs/crates/mainframe-adapter-codex/src/{thread_item_variants,item_types,event_mapper,session_state,turn_lifecycle,thread_item_render,history,history_convert,rollout_reconstruct,rollout_unified_exec}.rs` and a focused new command-metadata helper. Parse, retain sparse start metadata, project live/history identically, and preserve child attribution. |
| Display and ACP | `packages/core-rs/crates/mainframe-adapter-claude/src/messages/display_helpers.rs` and focused extracted helpers if needed; `packages/core-rs/crates/mainframe-acp/src/encoder.rs`. Preserve optional metadata through grouping and encode it into namespaced ItemMeta. |
| UI projection | `packages/ui/src/features/chat/view-model/convert-acp-item.ts` and a focused metadata reader if needed. Read the typed ItemMeta field and set native `providerMetadata.codex`; preserve all existing part fields. |
| Required constructor compatibility | Existing ToolUse/ToolCall constructors and exhaustive matches in affected Rust crates, notably `mainframe-adapter-claude`, `mainframe-adapter-api`, `mainframe-adapter-mock`, `mainframe-chat`, `mainframe-acp`, and `mainframe-server`, and their tests. Set the new field to absent for unrelated tools. Discover remaining sites with compiler diagnostics; do not refactor unrelated behavior. |
| Regression tests | Codex `tests/{item_types,event_mapper,history,live_vs_history_id_parity}.rs` or dedicated `tests/command_metadata.rs`; Claude display conversion/grouping tests; ACP `src/encoder/tests/` and `src/session_state/tool_patch/tests.rs`; shared Rust `tests/acp_golden_fixtures.rs` and `tests/fixtures/acp/`; TS `src/__tests__/acp-golden-fixtures.test.ts`; UI `view-model/__tests__/` focused metadata, accumulator, and projection cases. |
| Delivery note | One appropriate `.changeset/*.md` for preserving Codex tool metadata. |

### Implementation sequence

1. Add failing behavior tests at the adapter and shared contract boundaries. Include a version-labeled synthetic fixture derived from F1; do not label it a live capture. Define typed normalized metadata and compatibility behavior.
2. Implement Codex parsing and sparse start/completion retention, including null output normalization and child-thread cleanup. Reuse one metadata-aware Bash block helper for live and restored records. Update synthetic rollout constructors to use absent metadata.
3. Forward the optional per-tool field through transcript and display contracts, parent-id rewriting, grouping, ACP ItemMeta, and the native UI projection. Repair unrelated constructors with absent metadata. Keep modules small; extract only the touched behavior from oversized files.
4. Complete end-to-end projection regression cases and cross-language fixtures. Add the changeset. Run focused tests, relevant package checks, and the daemon workspace compile check; inspect the resulting diff for accidental presentation or execution-input changes.

### Observable regression matrix

| Case | Required observation |
| --- | --- |
| read, search, listFiles | Exact ordered actions and supplied fields reach the native tool part. Include nullable search/list fields. |
| old payload, null fields | Deserialization and ordinary Bash rendering succeed; unavailable metadata is absent. |
| empty, unknown, unfamiliar, mixed | Empty stays empty; known actions remain in order; unknown entries survive as unknown; no invented read/search/list action. |
| zero and positive duration | Exact integer `reportedDurationMs` reaches Rust serialization, Zod, ACP accumulation, and native projection. Include a non-round duration such as 1234 ms. |
| started actions, completed duration only | No new visible started row; completion retains actions, carries duration, and keeps provider tool/vendor ids. Completion-only and explicit-empty completion cases also pass. |
| interleaved parent/child starts | State does not leak between thread/item keys; consumed/aborted state is cleared. Parent-id rewriting preserves metadata. |
| ACP duration update | Same toolCallId, one accumulated item, both actions and added duration; group/container/parent metadata survives whole-object replacement. |
| history equivalence | Equivalent completed v2 items yield equal metadata and native tool parts through live and restored paths. Legacy synthesized rollout commands remain metadata-free. |
| grouped/nested calls | Group conversion and subagent projection preserve per-call metadata without attaching one call's data to its neighbors. |
| rendering invariants | Bash name, command-only args, output, nonzero-exit error, status, and grouping stay equal to the baseline when metadata is added. |

### Verification

Run actual test files created or modified by G1. Test names above describe intent and are not pre-existing runnable filters.

- Rust behavior tests for `mainframe-adapter-codex`, the touched display tests in `mainframe-adapter-claude`, `mainframe-acp`, and `mainframe-types`, using the repository command form `cargo test --manifest-path packages/core-rs/Cargo.toml -p <crate> <actual-filter>`.
- Shared TS golden/schema tests and focused UI accumulator/projection tests using package Vitest scripts. The documented UI form is `pnpm --filter @qlan-ro/mainframe-ui exec vitest run <actual-file>`.
- Rebuild shared types with `pnpm --filter @qlan-ro/mainframe-types build`; run shared-types `exec tsc --noEmit` and UI `typecheck`. Run ESLint on touched TS files, Rust formatting checks, and applicable Rust lint checks. Run `cargo check --manifest-path packages/core-rs/Cargo.toml --workspace` to catch all shared-enum constructors.
- Respect `docs/guides/rust-builds.md` from the primary checkout. Never set `CARGO_TARGET_DIR`; keep daemon and Tauri workspaces separate. This task does not require building the Tauri shell unless a changed shared contract proves that necessary.
- Before committing, run `git diff --check`, inspect only owned staged files for secrets, and leave normal hooks enabled. Existing unrelated changes remain untouched.

## QA boundary and handoff

Use a run-owned deterministic Codex app-server replay process through the actual Rust Codex adapter. Drive v2 `item/started`, `item/completed`, and `thread/read` responses; inspect ACP frames and UI/native projection after resume. The replay is controlled integration evidence, not a claim about live provider output. Keep its executable, fixtures, and logs outside the product diff. The caller owns the isolated daemon and QA process.

The executable override for live sessions and the history loader's `codex` lookup differ. QA may isolate PATH for its daemon; do not change product executable selection for this task. Verify the chosen process resolves the intended fixture before launch. A generic mock adapter does not validate Codex deserialization.

QA should assert unchanged terminal-only presentation, exact command/result/error output, retained actions with duration, zero and unknown/mixed cases, and reload parity for supplied metadata. Missing provider-persisted metadata is a named limitation, not a reason to infer values. G1's unit/projection tests remain necessary where UI presentation intentionally exposes no new text.

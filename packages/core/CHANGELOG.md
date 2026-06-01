# @qlan-ro/mainframe-core

## 0.21.0

### Minor Changes

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Migrate the stateless chat commands from WebSocket to REST. `chat.create`, `chat.updateConfig`, `chat.interrupt`, `chat.resume`, and the queued-message edit/cancel are now REST endpoints (`POST /api/chats`, `PATCH /api/chats/:id/config`, `POST /api/chats/:id/{interrupt,resume}`, `PATCH`/`DELETE /api/chats/:id/queue/:messageId`) returning the canonical envelope; the dead `chat.end` command is removed. The WebSocket is reserved for streaming and server-push — the 7 migrated inbound handlers and their `ClientEvent` variants are gone, so unsupported sends fail at compile time. A new `subscribe:ack` lets clients confirm a subscription is registered before resuming. `chat.created` is now a pure list-sync upsert (navigation is driven by the REST caller), and the `originClientId` attribution hack is removed. Hard cutover: the desktop client is migrated in this change; the mobile client ships the matching change in its own repo.

### Patch Changes

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Remove the unused `chatId` parameter from `createWorktree`. The argument was never read by the function body; callers in `config-manager` and the worktree tests are updated to the four-argument signature.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Remove the unused `getPreviewUrl` export from the launch module. It had no production callers — preview URLs are derived independently by the status handler — so the function, its barrel export, and its tests are deleted.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Extract PR/MR URL detection out of the Claude adapter's `events.ts` into a dedicated `pr-detection.ts` module. The regexes, command matchers, and URL parsers (`parsePrUrl`, `extractPrFromToolResult`, `isPrMutationCommand`, etc.) are a self-contained concern from event dispatch and already have their own test coverage; `events.ts` now imports them back. No behavior change.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Extract the shared subagent block-flattening loop in the Claude history reconstruction into one `appendAssistantBlocks` helper. `collectAgentProgressTools` and `collectSubagentAssistantBlocks` derive their parentId/content differently but appended the tool_use/text/thinking blocks with byte-for-byte identical code; that logic now lives in one place. No behavior change.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Collapse the four copy-pasted capability-guard Proxy blocks in `buildPluginContext` (db, attachments, events, ui) into a single `gated(enabled, capLabel, build)` helper. Same gating behavior — the real subsystem when its capability is declared, otherwise a Proxy whose methods throw the capability error.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Copy-paste consolidation in core (behavior-preserving):
  - `PluginManager`: extract the shared router-mount + `buildPluginContext` block from `loadBuiltin` and `loadPlugin` into a private `buildPluginRuntime` helper. The two paths still differ only in how they obtain the manifest and activate function; ordering and side effects are unchanged.
  - `ChatConfigManager`: extract `requireActiveChat` (getActiveChat + throw), `detachSession` (kill spawned session + null), and `applyWorktreeUpdate` (set path/branch + db update + emit) helpers, removing the same blocks copy-pasted across `updateChatConfig`/`enableWorktree`/`attachWorktree`/`disableWorktree`.
  - `ClaudeSession`: extract a `buildControlRequest` helper that owns the control_request envelope and a single `nanoid` request-id generator, replacing seven hand-rolled payloads that mixed `crypto.randomUUID` and `nanoid`.
  - Routes: add `resolveReadablePath` to `path-utils` (project-validated path, falling back to `~/.claude/`) and use it from the project-files and session-file read handlers, which previously inlined the identical dual-resolution.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Decompose the Claude adapter's `events.ts` (618 lines) by lifting the two largest stream-event handlers into their own modules: `assistant-event.ts` (`handleAssistantEvent` + the V2 task accumulator) and `user-event.ts` (`handleUserEvent` + subagent-child handling + skill-injection parsing). `events.ts` keeps stream framing, the small system/control/result handlers, and the `handleEvent` dispatch, dropping to 233 lines. No behavior change; the externally imported `handleStdout`/`handleStderr`/`handleControlResponseEvent` stay in `events.ts`.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Core hygiene pass (behavior-preserving):
  - Codex plan-mode handler: drop the four `as unknown as { ... }` casts of `ctx.active.session` and use the typed `AdapterSession` directly, matching the castless Claude sibling.
  - `AttachmentStore.deleteChat`: log the swallowed error instead of discarding it silently (a failure there means an invalid chatId segment, not a missing dir).
  - `git-write` route: narrow the two `catch (err: any)` handlers to `unknown` and extract the message via the codebase's standard `err instanceof Error ? err.message : String(err)` guard.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Replace the positional parameter lists of `createHttpServer` (11 params) and `createServerManager` (10 params) with a single `HttpServerDeps` options object (`ServerManagerDeps = Omit<HttpServerDeps, 'lspManager'>`). Call sites now name what they pass instead of relying on argument order. Behavior unchanged.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Close two issues from external review: validate the `attachmentId` path segment in `AttachmentStore.get` (a decoded `..%2F` could otherwise read another chat's attachments), and fix `isWithinBase` for a filesystem-root base so it no longer appends a double separator (a project rooted at `/` was wrongly rejected).

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Deep-review follow-up fixes for the tech-debt PR:
  - **Security (core):** the content-search JS fallback (used when ripgrep is unavailable) now re-resolves every enumerated file through `realpath` + project-boundary containment before reading it. Previously an in-repo symlink returned by `git ls-files` could escape the project and surface out-of-project file contents in search results.
  - **Regression (core):** todo attachment uploads accept zero-byte files again. WS10 tightened the schema to `data: z.string().min(1)`, which 400'd a legitimate empty file; relaxed to `z.string()` (length is carried by `sizeBytes`).
  - **Types:** add `ApiResponseEmpty` (`ApiOkEmpty | ApiErr`) for state-only routes that reply via `okEmpty`, and use it for the git stage/unstage/push desktop clients instead of `ApiResponse<never>`.
  - **Hygiene (core):** remove the dead, unreferenced `isGitRepo` helper from `workspace/worktree.ts`.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Address thermo-nuclear review of the tech-debt branch: remove the dangling `removeWithChats` test references left after the cascade collapse (a vacuous, type-erroring assertion); delete the now-unreachable `else` branch in the git diff handler (the Zod `source` enum already rejects non-git sources); route the git/tunnel handlers through the shared `validate()` helper instead of hand-rolling identical Zod error formatting; align the todos attachment 400 with the plugin's local convention; and import `ExecutionMode` at the top of the Claude session module instead of inline.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Close path-traversal, command-name and shell-interpolation seams. Fix a prefix-boundary bug in `resolveAndValidatePath` (a sibling dir sharing the base name prefix was admitted), consolidate the three divergent within-base checks onto one predicate, validate the `chatId` path segment in `AttachmentStore`, constrain the WS `command.name` to the identifier charset, and stop interpolating the probed command into the LSP `command -v` shell call.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Validate 7 previously-unguarded endpoints with Zod schemas (WS10): PATCH /chats/:id/title, PUT /projects/:id/files, POST/DELETE tunnel, POST /todos/:id/attachments, GET/DELETE adapters agents and skills, GET /projects/:id/git/diff.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Collapse project deletion into one transactional cascade. `remove(id)` now detaches child projects (`parent_project_id` → NULL), deletes child chats, and deletes the project atomically in a single transaction, replacing the bare `remove`/`removeWithChats` pair that could orphan chats or fail under `foreign_keys = ON`. Also prune the background-task tracker's per-chat maps when a chat ends, is archived, or its project is removed, fixing an unbounded memory leak.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Log or annotate previously-silent catch blocks (WS9 tech-debt sweep).

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix `_TaskProgress` accumulation in `groupToolCallParts`. Adapters mark the V2 task tools (`TaskCreate`/`TaskUpdate`) as both `hidden` (never a raw tool card) and `progress` (surfaced as a single `_TaskProgress` entry), but grouping checked hidden-suppression before progress-collection in the main loop and the reverse in the explore look-ahead. The result was that progress tools were dropped outright in the main loop and surfaced only when wedged between explore tools — position-dependent. Progress now takes precedence over hidden in both paths, so `_TaskProgress` is emitted consistently regardless of position. Test fixtures now mirror the real adapter categories so this can't regress.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - refactor(core): replace grouping sentinel round-trip with passthrough entry (WS14b)

  `applyToolGrouping` flattened DisplayContent into a parallel PartEntry model that
  only modeled text and tool-calls, smuggling every other content kind
  (thinking/image/skill_loaded/…) through grouping as a magic `\0ng:N` text string
  indexed into a side array, then decoding it back in two places via a regex.

  Replaces that with a first-class `{ type: 'passthrough'; content }` PartEntry
  variant: non-groupable content rides through grouping carrying its own data and
  parentToolUseId, and decodes by returning `part.content` directly. Removes the
  `nonGroupable` side array, the `\0ng:` encoding, and `NG_SENTINEL_RE`.

  Pure refactor — output is byte-identical, guarded by the WS14b characterization
  suite (positional interleaving, run-breaking, \_TaskProgress splice, task_group
  nesting, [#184](https://github.com/qlan-ro/mainframe/issues/184) agentId). Core tests 1627 pass.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Represent grouped tool/task content as first-class typed `DisplayContent`/`PartEntry` variants (`tool_group`, `task_group`, `task_progress`) instead of sentinel tool-calls matched by name. `convertGroupedPartsToDisplay` is now an exhaustive typed switch with no `_ToolGroup`/`_TaskGroup`/`_TaskProgress` string-matching. Internal refactor with no behavioral change (scattered task-progress accumulation and dedup preserved).

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Normalize the daemon HTTP API to a single response envelope. Every route now returns `{ success: true, data }` (or `{ success: true }` for state-only mutations) and `{ success: false, error }` on failure, replacing the previous mix of bare objects, bare arrays, and ad-hoc `{ tasks }` / `{ ok: true }` / `{ reason }` shapes. Git read endpoints keep their not-a-git-repo "soft errors" as successful empty payloads so the existing empty-state UX is unchanged. Desktop API consumers unwrap the envelope; the mobile client already tolerates both shapes. Internal-only change with no user-facing behavior difference.

- [#371](https://github.com/qlan-ro/mainframe/pull/371) [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57) Thanks [@doruchiulan](https://github.com/doruchiulan)! - refactor(core): consolidate git layer - shared parsers, single base-branch detection, async worktree exec (WS5)

  The git route layer duplicated parsing and base-branch logic, and the worktree
  helper talked to git three different ways including blocking sync I/O on the
  daemon event loop.
  - Extract byte-identical `isNotGitRepo`, `parseDiffNameStatus`, `parseStatusLines`
    and the porcelain bucket parser (typo `parsePortcelainStatus` fixed to
    `parseStatusBuckets`) into one shared `git/git-parse.ts`, with direct unit tests.
  - Replace the three copies of the `['main','master']` merge-base loop with a single
    `GitService.detectBaseBranch()`; routes consume it. Response shapes unchanged.
  - Migrate `workspace/worktree.ts` off `execFileSync`/`mkdirSync` and its private
    `promisify(execFile)` onto the canonical async `execGit` + `fs/promises`;
    `createWorktree` and `getWorktrees` no longer block the event loop. Callers in
    `config-manager.ts` await accordingly.
  - Remove the dead, unexported `isGitRepo` helper (zero callers).

  Pure refactor; behavior preserved. Full build green, core tests 1611 pass.

- Updated dependencies [[`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57), [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57), [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57), [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57), [`2346f82`](https://github.com/qlan-ro/mainframe/commit/2346f82a4bb8cddd776b51af3186019076b52b57)]:
  - @qlan-ro/mainframe-types@0.21.0

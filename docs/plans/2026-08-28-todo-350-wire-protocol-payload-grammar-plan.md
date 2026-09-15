# Implementation plan: ACP server facade for the chat surface (todo #350)

Spec: `docs/specs/2026-08-28-todo-350-wire-protocol-payload-grammar.md` (committed
`4b2ce982`). Goal: the daemon exposes an ACP v2-snapshot server facade for the chat
surface over the existing WS binding — `initialize` handshake with a pinned version
and `_mainframe.dev` capabilities, `session/update` streaming with stable item IDs
and chunk/patch (never whole-message) revisions, explicit turn lifecycle with stop
reasons and `api_retry` invalidation, `session/resume` replay replacing the four
reconnect re-seed mechanisms, permission gates with adapter-supplied option lists
and rich extension answers, subagents as tool calls with `_meta` parent relations
(no `task_group` on the facade), and a single canonical encoder shared by live
streaming and history replay. The legacy dialect stays frozen and byte-compatible
alongside; desktop cuts over, mobile follows in its own repo.

## Plan decisions (spec left these to the plan)

1. **Vendored types, not upstream crates.** The ACP v2 subset is hand-written into
   `mainframe-types` (new `acp` module) and `packages/types`, verified by shared
   golden wire fixtures — the existing parity mechanism. Not `agent-client-protocol`
   2.0.0: its v2 is behind the `unstable_protocol_v2` feature with no semver
   protection, contradicting Decision 2's frozen snapshot; the workspace runs a
   curated dependency list (fact 8); and the TS SDK is v1-only (fact 10), so the TS
   side would be hand-written regardless.
2. **The facade is a new crate (`mainframe-acp`) fed by a new chat-surface seam in
   `mainframe-chat`, not a projection of the legacy `DaemonEvent` broadcast.** Turn
   boundaries, prompt acceptance, stop reasons, and retry do not exist as
   `DaemonEvent`s (facts 1, 6), so the legacy stream cannot express the facade.
   `mainframe-chat` gains an observer seam both surfaces are driven from; the legacy
   emit paths are untouched (frozen).
3. **The canonical encoder consumes `DisplayMessage[]`** — already adapter-generic —
   and lives in `mainframe-acp`. This sidesteps the documented cycle constraint
   (`mainframe-chat` cannot depend on `mainframe-adapter-claude`, fact 9): live
   streaming and history replay both already produce `DisplayMessage[]` via the
   injected `PrepareFn`, so one encoder over that type is the single-encoder
   guarantee (criterion 10). `task_group` flattening to tool-call items with
   `_meta` parent relations happens inside this encoder.
4. **`sessionId` = `chatId`; the `/acp/{adapter-profile}` path segment selects the
   adapter** (claude, codex, mock) used for `session/new` defaults. Existing chats
   attach via `session/resume` with their chatId. One facade connection multiplexes
   N sessions (JSON-RPC over WS text frames, same auth as the legacy `/` upgrade).
5. **Criterion 3 vs criterion 12 reconciliation.** Live message ids are minted
   nondeterministically (fact 2), so no working fixture diff can byte-pin them —
   criterion 12's byte-compatibility is over frame shapes and deterministic fields.
   The stable-ID retrofit changes id *values* only. Task 4 characterizes current id
   sources and pins the legacy frame-shape guard before any derivation changes.
   Fallback if characterization finds legacy consumers or fixtures that do pin live
   id values: scope stable-ID derivation to a facade-side id map during the
   migration window instead of changing the shared pipeline.
6. **`--include-partial-messages` adoption is out of this plan.** Per spec Decision 7
   the grammar supports chunking for every kind from day one; emission stays
   block-granularity until the Claude adapter adopts partial messages — file that as
   a follow-up todo when this lands.
7. **Docs land inside group E** (API-REFERENCE facade section + legacy freeze
   markers), not as a standalone group. Changesets are exit criteria of the final
   groups, not tasks.

## Established facts

1. `api_retry` has zero handling sites in the daemon — `grep -r api_retry
   packages/core-rs/crates` matches nothing outside research docs (run 2026-08-28
   in this worktree).
2. Live-path `ChatMessage` ids are transient: `create_transient_message` mints
   `nanoid::nanoid!()` — `mainframe-chat/src/message_cache.rs:100`, used by the
   sink event handler via `transient()` (`mainframe-chat/src/event_handler.rs:328`).
3. History-path ids derive from transcript uuids with nanoid fallback:
   `id_or_nanoid` / `uuid_or_nanoid_nullish`,
   `mainframe-adapter-claude/src/history_converters.rs:19-35`.
4. `DisplayMessage.id` is the `ChatMessage` id verbatim:
   `mainframe-adapter-claude/src/messages/display_pipeline.rs:81` (`msg.base.id`),
   deduped by id at `display_pipeline.rs:56-68`.
5. The legacy emitter re-sends whole messages on every revision:
   `mainframe-chat/src/display_emitter.rs:21-100` emits
   `display.message.updated`/`display.messages.set` carrying full `DisplayMessage`s.
6. The legacy wire contract is `DaemonEvent` (63 variants) / `ClientEvent` (6):
   `mainframe-types/src/events.rs:3-6`; no turn/retry/version variants exist.
7. Fan-out gating is chatId-scoped with a connection-global allowlist:
   `mainframe-server/src/websocket.rs:51-55,666-695`. Reconnect re-seed today =
   queue snapshot + worktree offers + `subscribe:ack` (`websocket.rs:430-463`) plus
   client-side REST history refresh; no app-level heartbeat (axum auto-pongs,
   `websocket.rs:382`).
8. The Rust workspace runs a curated dependency allowlist: `futures_util` was
   rejected and forced a documented design deviation
   (`mainframe-server/src/websocket.rs:10-17`); all deps are centralized in
   `packages/core-rs/Cargo.toml [workspace.dependencies]`.
9. `mainframe-chat` cannot depend on `mainframe-adapter-claude` (Cargo cycle); the
   display pipeline is injected as `PrepareFn` —
   `mainframe-chat/src/display_emitter.rs:11-16`.
10. ACP pins (all from `docs/research/ACP-EVALUATION.md`, sources table + §A.5,
    read out of tree): spec repo snapshot `d0370de50e16` (v2 `schema/v2/schema.json`,
    schema crate 1.7.0); Rust SDK `agent-client-protocol` 2.0.0 with v2 behind
    `unstable_protocol_v2`; TS SDK `@agentclientprotocol/sdk` 1.4.0 is v1.
    Patch semantics (omit/null/value/append), `PermissionOption`,
    `RequestPermissionOutcome`, `UsageUpdate`, `_meta` discipline per its
    "What to borrow" §1-6.
11. TS↔Rust wire parity runs on shared golden fixtures:
    `mainframe-types/src/events.rs:549-684` (`include_str!` round-trips) and
    `mainframe-types/tests/golden_fixtures.rs`.
12. The adapter sink surface is ~24 callbacks (`on_message`, `on_permission`,
    `on_result`, `on_queued_processed`, …):
    `mainframe-adapter-api/src/adapter.rs:78-114`. Adding a defaulted callback is
    non-breaking for existing adapters.
13. The e2e mock adapter replays recorded event fixtures through the same sink:
    `mainframe-adapter-mock/src/fixture.rs` (`parse_fixture`, `RecordedEvent`),
    driven by `dispatch.rs`/`session.rs`.
14. The UI consumes the legacy dialect through one seam:
    `packages/ui/src/lib/daemon/ws-client.ts` (`DaemonWsClient`), with chat state in
    `packages/ui/src/features/chat/controller/chat-thread-controller.ts` and
    rendering via `packages/ui/src/features/chat/view-model/convert-message.ts`.
15. `docs/plans/` is gitignored in this repo (`git check-ignore` confirms);
    committing this plan requires `git add -f`.

## Task groups

Groups run in dependency order; each group is one implementer session. TDD inside
every group: the test task precedes the implementation it pins. Verification is
stated as intent — implementers own their commands.

### Group A — `acp-types`: vendored protocol types (tasks 1-3)

Files: `packages/core-rs/crates/mainframe-types/src/acp/` (new module dir) +
`src/lib.rs` export, `packages/core-rs/crates/mainframe-types/tests/fixtures/acp/`
(new), `packages/types/src/acp.ts` (new, plus an `index.ts` export),
`packages/types/src/__fixtures__/` additions.

1. **Golden wire fixtures first.** Author JSON fixtures for every frame the facade
   speaks, derived from the pinned v2 snapshot: JSON-RPC envelope,
   `initialize` request/response with `_mainframe.dev` capabilities,
   `session/new|prompt|cancel|resume`, `session/update` with message/thought
   chunks, `tool_call` + `tool_call_update` patch (omit/null/value/append cases),
   stop reasons, `session/request_permission` + both answer shapes (plain
   `{optionId}` and `_mainframe.dev` rich answer carrying `ControlResponse`),
   retry marker, queued-state metadata, usage update, heartbeat, structured
   errors. One fixture file per frame kind, shared by both languages.
   Verification: fixtures parse as JSON and cover every acceptance-criteria frame;
   reviewers can diff each against the vendored snapshot's shapes.
2. **Rust types.** Hand-write the v2 subset + extension types in
   `mainframe-types/src/acp/`, serde round-trip tests over the task-1 fixtures
   (same pattern as `events.rs`). Patch fields must distinguish omitted from null
   (double-`Option` or equivalent) — the patch grammar depends on it.
   Verification: round-trip tests pass for every fixture; `cargo` build of the
   types crate stays warning-free.
3. **TS types + Zod schemas.** Mirror in `packages/types/src/acp.ts` with Zod
   schemas for every inbound frame (criterion 2's TS-side validation); vitest
   round-trips over the same fixture files.
   Verification: TS round-trip tests pass against the identical fixtures the Rust
   tests use; the types package typechecks.

kind: core · parallel_safe: true · depends_on: []

### Group B — `stable-ids`: canonical item identity (tasks 4-6)

Files: `mainframe-chat/src/message_cache.rs`, `mainframe-chat/src/event_handler.rs`,
`mainframe-adapter-api/src/adapter.rs` (message metadata carries the vendor uuid),
`mainframe-adapter-claude/src/events.rs` + `src/user_event.rs` +
`src/assistant_event.rs` (thread the transcript uuid into sink calls),
`mainframe-adapter-claude/src/history_converters.rs`,
`mainframe-adapter-codex/src/` (item-id threading, same seam),
`mainframe-adapter-mock/src/` (deterministic ids in replay).

4. **Characterization + legacy-shape guard (red phase for the group).** A test that
   documents today's id sources: live path mints nanoid (fact 2), history path
   uses transcript uuids (fact 3), so live ≠ replay ids — the gap Decision 3
   closes. Plus a frame-shape guard: capture the legacy `DaemonEvent` stream from
   a mock-adapter replay and pin its shape (field set, types, ordering) while
   masking nondeterministic id/timestamp values. This guard is the group's — and
   the lane's — criterion-12 tripwire, sitting where the violation would happen,
   not in e2e at the end.
   Verification: the guard passes pre-change; the characterization assertions
   state the current (unequal) derivations and fail once task 5/6 land, forcing
   their update to pin the new invariant.
5. **Live path: vendor-derived ids.** Adapter sinks pass the transcript uuid /
   vendor item id with each message; `event_handler`/`message_cache` use it as the
   `ChatMessage` id instead of minting nanoid (nanoid stays only as the
   no-vendor-id fallback). Mock adapter emits deterministic ids so tests can
   assert equality.
   Verification: unit tests show a live-streamed message and its history
   reconstruction carry the same id (criterion 4's unit-level form); the task-4
   shape guard still passes.
6. **History path parity.** Reconcile `history_converters` derivation with the live
   path (same uuid canonicalization, same dedupe rules as
   `display_pipeline.rs:56-68`), including subagent/sidechain entries.
   Verification: for a recorded transcript, live-pipeline ids == history ids
   across message kinds, asserted in a test that runs both paths on one fixture.

kind: core · parallel_safe: false (shares `event_handler.rs`/adapter files with
group D) · depends_on: []

### Group C — `facade-endpoint`: connection, handshake, heartbeat (tasks 7-9)

Files: `packages/core-rs/crates/mainframe-acp/` (new crate: `Cargo.toml`,
`src/lib.rs`, `src/rpc.rs`, `src/connection.rs`, `src/capabilities.rs`),
`packages/core-rs/Cargo.toml` (workspace-deps entry only — `members` is a glob),
`mainframe-server/src/http.rs` + `src/lib.rs` (route mount),
`mainframe-server/src/routes/` or a new `src/acp_ws.rs` (upgrade handler),
`mainframe-server/src/ctx.rs` (facade registry on `AppCtx`).

7. **JSON-RPC codec + structured errors (tests first).** Frame parse/serialize for
   requests, responses, notifications over WS text frames; malformed frame →
   structured JSON-RPC error, connection stays open (criterion 2); unknown or
   unadvertised method → method-not-found (edge case list).
   Verification: codec unit tests cover the fixture set from task 1 plus
   malformed/unknown-method cases.
8. **`/acp/{adapter-profile}` route + `initialize`.** Upgrade handler with the same
   auth rule as the legacy `/` route (fact 7's `is_ws_auth_required`); profile
   segment validated against registered adapters; `initialize` negotiates the
   pinned version and advertises `_mainframe.dev` capabilities; unsupported
   version → structured error, connection open (criterion 1). Serde-side
   validation of every inbound frame (criterion 2).
   Verification: an integration test in the style of `ws_integration.rs` connects,
   initializes, and asserts criterion 1's both branches.
9. **Heartbeat + connection registry.** App-level heartbeat notification at a
   documented interval; per-connection session-attach registry on `AppCtx`
   (parallel to `ws_clients`, facade-only).
   Verification: integration test observes heartbeats at the configured interval
   (criterion 11's daemon half).

kind: core · parallel_safe: false (shares `mainframe-acp` crate files with groups
D/E) · depends_on: [acp-types]

### Group D — `streaming-bridge`: seam, encoder, deltas, turns (tasks 10-14)

Files: `mainframe-chat/src/chat_surface.rs` (new seam), `src/event_handler.rs`,
`src/chat_manager/deps_event.rs` + `send.rs` (observer wiring, prompt acceptance),
`mainframe-adapter-api/src/adapter.rs` (defaulted `on_api_retry`),
`mainframe-adapter-claude/src/events.rs` (parse `api_retry`),
`mainframe-adapter-mock/src/fixture.rs` + `dispatch.rs` (retry + id vocabulary),
`mainframe-acp/src/encoder.rs`, `src/session_state.rs`, `src/throttle.rs`,
`src/prompt.rs` (new).

10. **Chat-surface seam.** An observer trait registered on `ChatManager` deps that
    both surfaces can be driven from: turn accepted/started/finished (with stop
    reason: completed/cancelled/error), display revision (the `DisplayMessage[]`
    snapshot the legacy emitter already computes), gate raised/resolved, retry,
    compaction, usage. Legacy emit paths unchanged; the observer is called
    alongside. Adapter death mid-turn ends the turn with an error stop reason
    (edge case list).
    Verification: unit tests drive the sink handler and assert the observer sees
    the turn lifecycle the legacy stream cannot express (fact 6).
11. **`api_retry` wiring.** Parse the CLI's `api_retry` event in the Claude
    adapter, add a defaulted sink callback, surface it through the seam; extend
    the mock adapter's fixture vocabulary so a recorded retry can be replayed
    (criterion 7's fixture). The facade models it as a content-replacing patch +
    namespaced retry marker (spec Decision 10).
    Verification: an adapter unit test parses a captured `api_retry` line; a mock
    replay produces the retry signal at the seam. The daemon no longer drops the
    event (fact 1 inverted).
12. **Canonical encoder.** `DisplayMessage[]` → ACP item list with stable ids;
    subagent/task content flattens to tool-call items carrying `_meta` parent
    relations — no `task_group` on the facade (criterion 10). Pure function,
    property: same input → same output, so live and history replay encode
    identically by construction.
    Verification: encoder unit tests cover text/thinking/tool/subagent/plan
    shapes; a test encodes a live-pipeline snapshot and its history
    reconstruction (same transcript, groups B outputs) and asserts identical
    items.
13. **Per-session diff engine + throttle.** Item state per attached session;
    consecutive encoder outputs diff into chunk appends (text/thought suffix) and
    `tool_call_update`-style patches (omit/null/value/append); server-side
    coalescing so fan-out volume stays bounded (spec Decision 14). Invariant: after
    an item's first frame, no emitted frame repeats its full accumulated content
    (criterion 3).
    Verification: unit tests assert the no-full-resend invariant over an N-revision
    growing message and a revision (patch) case; throttling coalesces bursts.
14. **Prompt lifecycle.** `session/prompt` → `ChatManager::send_message`; immediate
    acceptance distinct from turn completion; queued prompts get queued-state
    metadata via the extension namespace and are cancellable pre-turn; no
    `queue.*` family on the facade (criterion 5); `session/cancel` ends the turn
    with cancelled stop reason and cancels open gates (criterion 6); prompt to a
    dead/degraded session → structured error (edge case).
    Verification: integration tests over the mock adapter assert criteria 5 and 6
    end to end on the facade seam.

kind: core · parallel_safe: false (shares files with groups B, C, E) ·
depends_on: [acp-types, stable-ids, facade-endpoint]

### Group E — `resume-and-gates`: replay, permissions, docs (tasks 15-18)

Files: `mainframe-acp/src/resume.rs`, `src/gates.rs` (new),
`mainframe-chat/src/chat_manager/history.rs` (replay hook),
`mainframe-chat/src/permission_handler.rs` / `permission_manager.rs` (facade
answer path), `docs/API-REFERENCE.md`.

15. **`session/resume`.** Cursor scheme over the stable item sequence; replay after
    the cursor from the canonical encoder over history reconstruction (same ids as
    live — criterion 4's replay half); open permission request redelivered;
    unknown or pre-compaction cursor → full replay with compaction marker
    (criteria 9, edge cases).
    Verification: integration test streams a turn, resumes from a mid-turn cursor,
    and asserts id equality and open-gate redelivery; unknown cursor yields full
    replay without error.
16. **Permission gates on the facade.** `session/request_permission` with
    adapter-supplied ordered option lists; plain `{optionId}` honored; rich
    `_mainframe.dev` answer carries today's `ControlResponse` semantics
    (input mutation, suggestions, execution mode, clear context); answers
    validated before applying; unknown extension values never treated as approval.
    Verification: unit tests cover both answer shapes and the AskUserQuestion-style
    input mutation (criterion 8's shapes).
17. **Multi-client + cross-surface resolution.** Gate broadcast to all attached
    facade sessions; first answer wins, late answer → structured "resolved"
    outcome; a gate answered on the legacy surface resolves on the facade and
    vice versa (migration-window edge case).
    Verification: integration test with two facade clients plus one legacy client
    asserts single application and resolution fan-out everywhere.
18. **Contract docs.** `docs/API-REFERENCE.md`: facade seam, pinned protocol
    version, capability/extension namespace, heartbeat + resume sync contract
    (spec Decision 13), migration window, legacy chat-surface events marked
    frozen (criterion 14).
    Verification: the doc names every facade method/notification shipped by groups
    C-E and matches the pinned fixture vocabulary; a reviewer can trace each
    acceptance criterion to a documented behavior.

kind: core · parallel_safe: false (shares `mainframe-acp` with C/D) ·
depends_on: [streaming-bridge, stable-ids]

### Group F — `ui-facade-client` (tasks 19-21)

Files: `packages/ui/src/lib/daemon/acp-client.ts` (new; `ws-client.ts` untouched
for non-chat domains), `packages/ui/src/features/chat/controller/
chat-thread-controller.ts` + its `__tests__/`,
`packages/ui/src/features/chat/view-model/convert-message.ts` + `__tests__/`,
`packages/ui/src/features/sessions/runtime/chat-controller-registry.ts`.

19. **Facade client.** JSON-RPC-over-WS client: connect to `/acp/{profile}`,
    `initialize`, session attach, resume-on-reconnect with cursor, heartbeat-gap
    detection → resume (criterion 11's client half). Zod-validate inbound frames
    (criterion 2).
    Verification: unit tests over a mocked socket cover handshake, gap-resume, and
    validation rejects.
20. **Controller rework.** `chat-thread-controller` consumes items/chunks/patches
    into its message state; the four legacy re-seed paths (`subscribe:ack` re-seed,
    REST history refresh, queue snapshot, pending-permission recovery) are
    replaced by resume replay on the facade path. Queued prompts render from
    accepted-prompt metadata.
    Verification: the controller's existing behavioral test suite is ported to the
    facade seam and passes; reconnect scenarios assert state converges from
    resume alone.
21. **convert-message rework.** ACP items → aui messages with stable ids (aui's
    MessageRepository dedupes by id — stable ids must not collide across turns);
    subagent attribution renders from `_meta` relations instead of `task_group`
    nesting.
    Verification: convert-message unit tests cover every item kind incl. subagent
    attribution and patch-revised items.

kind: ui · parallel_safe: false (shares `chat-thread-controller.ts` with group G) ·
depends_on: [acp-types, resume-and-gates]

### Group G — `ui-gates` (task 22)

Files: `packages/ui/src/features/chat/gates/` (option-list rendering,
`build-control-response.ts`), minimal wiring edits in
`chat-thread-controller.ts`.

22. **Gate UI on option lists.** Gates render adapter-supplied ordered options;
    the client never infers a permission's effect from option kind or label; rich
    answers (AskUserQuestion input mutation, suggestion rules, plan-mode
    execution/clear-context) ride the `_mainframe.dev` answer; plain option
    selection works for generic display.
    Verification: gate component tests cover option rendering, rich-answer
    construction, and the no-effect-inference rule (labels changed, behavior
    identical).

kind: ui · parallel_safe: false (shares controller wiring with group F) ·
depends_on: [ui-facade-client]

### Group H — `e2e` (tasks 23-24)

Files: `packages/e2e/scenarios/` + `tests-tauri/` (new facade specs),
`packages/e2e/fixtures/` (retry fixture, legacy-frame baseline),
`packages/e2e/helpers/tauri/ws-control.ts` (facade-aware control).

23. **Facade e2e suite.** Mock-adapter-driven specs for the streaming invariant
    (criterion 3), id stability live-vs-resume (4), prompt-during-turn with no
    `queue.*` frames (5), retry patch without duplication (7), resume with open
    gate (9), heartbeat + resume-after-silence (11).
    Verification: the new specs pass against the built daemon; each spec maps
    one-to-one to its acceptance criterion.
24. **Legacy freeze + dual-surface spec.** An e2e check that the legacy dialect's
    chat frames match the pre-change recorded baseline (shape + deterministic
    fields, ids masked per plan decision 5) — criterion 12's end-to-end form,
    backstopping group B's unit guard — plus one dual-surface scenario: same chat
    on a legacy client and a facade client, gate answered once, both consistent.
    Verification: baseline diff green; dual-surface spec asserts cross-surface
    gate resolution and consistent transcripts.

kind: test · parallel_safe: true · depends_on: [resume-and-gates,
ui-facade-client, ui-gates]

## Exit gates

- All 14 spec acceptance criteria have a named owning task (1→8, 2→3/7/8/19,
  3→13/23, 4→5/6/15/23, 5→14/23, 6→14, 7→11/23, 8→16/22, 9→15/23, 10→12,
  11→9/19/23, 12→4/24, 13→2/3, 14→18).
- Typecheck, unit suites, and `cargo` builds green per package; e2e batched at the
  end (group H) per repo practice.
- Changesets for `mainframe-types`, `mainframe-ui` (and empty for docs-only
  commits) accompany the final PR — exit criterion, not a task.
- Follow-up todos filed on completion: `--include-partial-messages` adoption
  (token-granularity emission), mobile facade migration (own repo), legacy
  chat-event removal after both clients cut over.

## Risks

- **v2-draft drift**: upstream ACP evolves past the frozen snapshot; deviations
  become our maintenance line (spec Decision 2). Mitigation: the vendored fixture
  set is the single conformance point to re-diff on upgrade.
- **Stable-ID retrofit fallout**: aui MessageRepository dedupes by id; CLI uuid
  reuse (compact boundaries — `display_pipeline.rs:53-56`) must keep the existing
  dedupe. Task 4's characterization catches surprises before derivation changes.
- **Fan-out throughput**: chunk emission multiplies frame count; the group-D
  throttle is the guard, criterion 3 the contract.
- **e2e fixture churn**: recorded mock streams encode old shapes; group H re-records
  only facade-side expectations, legacy baselines stay as the freeze oracle.
- **Cross-repo mobile window**: legacy freeze must hold until the mobile PR lands;
  nothing in groups A-H may alter legacy chat-frame shapes (group B guard + group
  H baseline enforce this).

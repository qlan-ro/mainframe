# Wire-protocol payload grammar: ACP server facade for the chat surface

Todo #350. Sources: `docs/research/WIRE-PROTOCOL-SURVEY.md` (verdicts and refactor
direction), `docs/research/ACP-EVALUATION.md` (facade addendum, "What to borrow"),
`docs/research/AG-UI-EVALUATION.md` (coverage method), and
`docs/research/adapters/claude/AGENT-SDK-PARITY.md` (B4, `--include-partial-messages`).
These four docs were read out of tree — they are untracked in the primary checkout
and absent from this branch; the paths above are where they will live once committed.
The transport decision (persistent WS, per-chat subscriptions, out-of-band gates,
daemon-authoritative state) was made in the survey and is not relitigated here.

## Problem

The daemon↔client chat payload grammar grew organically and lacks the properties
every reference protocol has. There is no protocol version — `connection.ready`
carries only a `clientId`, so mobile compatibility rests on an additive-only social
contract. There are no deltas — every revision of a growing message re-sends the
whole `DisplayMessage`, which is why streaming feels block-level and why WS payload
volume grows with message length. There is no explicit turn/abort/retry framing —
the CLI's `api_retry` events have zero handling sites in the daemon, so retried
partial output cannot be invalidated client-side. The nested `task_group` payload
is encoded at two sites (live display pipeline and history reconstruction), and
extensions are ad-hoc fields with no namespace discipline.

Reconnect today is four separate mechanisms (`subscribe:ack` re-seed, REST history
refresh, queue snapshot, pending-permission recovery), each a source of ordering
bugs. Users see the symptoms as chunky streaming, stale partial output after
provider retries, and occasional wrong-order history after reconnect.

## Behavior

The chat surface becomes an **ACP server facade**: the daemon speaks the Agent
Client Protocol (v2 semantics, frozen snapshot — see Decisions) to chat clients
over the existing WS binding, at a dedicated per-adapter-profile endpoint.
Non-chat domains (launch, plugins, automations, tunnels, file watch, notifications)
stay on the existing dialect unchanged. Mainframe aims for ACP conformance from
the start and deviates only on concrete blockers, recorded as decisions.

**Handshake.** A client opens the facade and negotiates protocol version and
capabilities via `initialize`. The daemon advertises its Mainframe extension
capabilities under the `_mainframe.dev` namespace. A client requesting an
unsupported version gets a structured error, not a dropped connection. Generic
ACP clients that advertise no Mainframe capabilities get a degraded but coherent
chat experience (option-only gates, no queued-turn metadata).

**Streaming.** Turn output arrives as `session/update` notifications carrying
items with **stable IDs** — the same ID identifies an item in the live stream,
in resume replay, and in history reconstruction. Message and thought content
streams as appending chunks; tool calls update via patch semantics (omitted
field = unchanged, null = cleared, value = replaced, content chunks append).
A growing message is never re-sent whole. Revision — what today's
`display.message.updated` does — is expressed as a patch, not a replacement
frame. Token-granularity deltas for text and reasoning arrive once the Claude
adapter adopts partial-message streaming; until then chunks are block-granularity,
with server-side coalescing/throttling so fan-out volume stays bounded.

**Turn lifecycle.** `session/prompt` acceptance is separate from turn completion:
a prompt sent while a turn is running is accepted immediately and runs when its
turn comes — queued messages become ordinary accepted prompts, visible with a
queued state and cancellable before their turn starts. The `queue.*` event family
does not exist on the facade. Turns end with an explicit stop reason (completed,
cancelled, error). A provider retry (`api_retry`) surfaces as a patch that
replaces the affected item's partial content plus a retry marker, so stale
output disappears instead of duplicating.

**Reconnect and sync.** A reconnecting client calls `session/resume` with a
cursor; the daemon replays everything after it with the same stable item IDs,
including any still-open permission request. An unknown or compacted cursor
yields a full replay. A heartbeat runs on the connection; a client that detects
a gap resumes rather than heuristically refetching. This one mechanism replaces
the four re-seed paths listed above.

**Permission gates.** Gates remain mid-turn blocking requests
(`session/request_permission`) while updates keep streaming. The adapter supplies
an ordered option list (the gate's presentation model); Mainframe-aware clients
send rich answers (input mutation, suggestion rules, execution mode, clear
context) via the `_mainframe.dev` extension surface, and a plain ACP answer
(selected option ID) is also honored. Clients must not infer a permission's
effect from option kind or label — the daemon/adapter owns the effect. Gate
resolution fans out to every attached client.

**Subagents and task groups.** Subagent activity is represented as tool calls
carrying parent-attribution relations in namespaced metadata. The nested
`task_group` payload is retired on the facade, and the daemon encodes the chat
surface through a single canonical encoder — live streaming and history replay
of the same transcript produce identical items.

**Extensions.** All Mainframe-specific vocabulary — gates' rich answers, queued
state, compaction, context usage and cost (`usage_update`-style occupancy plus
money), trust prompts, PR detection — rides ACP's sanctioned extension points:
`_`-prefixed custom methods and namespaced `_meta`, gated by advertised
capabilities. Unknown extension values are never treated as approval.

**Migration.** Dual-surface coexistence: the facade ships alongside the legacy
dialect, whose chat-surface frames stay byte-compatible (frozen, additive-only)
for the whole window. Desktop switches to the facade first; mobile follows in
its own PR in its own repo; legacy chat-surface events are removed only after
both are cut over. Version negotiation happens on the new seam (`initialize`),
not by versioning the legacy dialect.

## Not Included

- Generic `mainframe-adapter-acp` for long-tail agents (ACP-EVALUATION verdict A3) — `deferred`, separate todo.
- Third-party ACP clients (Zed, JetBrains) attaching to Mainframe chats — `deferred`, blocked on ACP's remote-transport RFD and a specified multi-observer semantic.
- Mobile client implementation — `deferred`, separate repo, own PR; this spec only guarantees the frozen legacy dialect it needs meanwhile.
- Tool-input token deltas beyond text/reasoning chunking — `deferred` to the phase after partial-message adoption (Decision 7).
- Advertising ACP `fs/*` / `terminal/*` client services on the facade — `declined`, ownership inversion; the daemon owns files and terminals (and v2 removes them).
- Replacing the native Claude/Codex adapters with ACP bridges — `declined`, survey verdicts A1/A2.
- Changing the transport (WS, subscriptions, out-of-band gates) — `declined`, decided upstream in the survey.
- Non-chat event domains (`launch.*`, `plugin.*`, `automation.*`, `workflow.*`, `tunnel:status`, `file:changed`, `sessions.external.count`, notifications) — `platform`, stay on the existing dialect indefinitely.

## Edge cases

- Reconnect while a permission gate is open: resume replay redelivers the open request; an answer to an already-resolved gate gets a structured "resolved" outcome, not a double-apply.
- Two clients answer the same gate: first answer wins; the second client receives the resolution and its late answer is rejected as resolved.
- Same chat live on mobile (legacy dialect) and desktop (facade) during the migration window: both stay consistent; a gate answered on either surface resolves on both.
- `api_retry` mid-stream: the retried item's content is replaced once; a client that reconnects after the retry sees only the post-retry content in replay.
- Queued prompt cancelled before its turn starts: it is removed, never runs, and does not appear as a turn in replay.
- `session/resume` with an unknown cursor, or one older than a compaction boundary: full replay, no error.
- Adapter process dies mid-turn: the turn ends with an error stop reason; partial items keep their last state and are marked terminal.
- Prompt sent to a chat with a dead/degraded session: structured error on the prompt request, consistent with today's degraded-chat behavior.
- Client sends an extension method the daemon did not advertise: structured method-not-found error; connection stays open.
- Compaction while a client is disconnected: resume detects the cursor predates the boundary and falls back to full replay with the compaction marker.

## Acceptance criteria

1. Connecting to the facade endpoint and calling `initialize` returns the pinned protocol version and a capability set that includes the `_mainframe.dev` extension namespace; requesting an unsupported version returns a structured error and the connection stays open.
2. Every inbound facade message is schema-validated (serde-side in the daemon, Zod-side in TS consumers and the e2e mock); a malformed frame gets a structured error without dropping the connection.
3. During a streamed turn of N revisions to one message, the facade emits only chunk/patch updates after the item's first frame — asserted against the e2e mock adapter: no frame repeats the item's full accumulated content.
4. Item IDs are stable: the IDs observed on a live streamed turn equal the IDs returned by `session/resume` replay and by history reconstruction of the same transcript (equality assertion in tests).
5. A `session/prompt` sent during an active turn is accepted immediately, runs after the current turn, and no `queue.*`-family frame appears on the facade seam.
6. Cancelling a turn produces a cancelled stop reason, answers any open gate as cancelled, and no further updates for that turn follow.
7. An `api_retry` fixture produces a content-replacing patch with a retry marker and no duplicated items; the daemon no longer drops the event.
8. A mid-turn permission request carries at least one adapter-supplied option; a rich `_mainframe.dev` answer (e.g. input mutation) is applied; a plain `{optionId}` answer is also honored; resolution reaches every attached client.
9. Reconnect + `session/resume` from a cursor redelivers any open permission request and all items after the cursor; an unknown cursor yields full replay.
10. Subagent tool calls carry parent-attribution metadata; no nested `task_group` payload appears on the facade; live stream and history replay of one transcript produce identical encodings (the single-encoder check).
11. Heartbeat frames arrive at the documented interval, and a client that misses them can resume with no gap (resume-after-silence e2e).
12. Legacy-dialect chat frames are byte-compatible with pre-change recorded fixtures for the whole migration window (fixture diff in e2e).
13. New facade wire types exist in both the TS types package and the Rust types crate with round-trip fixture tests (existing TS↔Rust parity mechanism), and every new daemon surface has tests.
14. `docs/API-REFERENCE.md` documents the facade seam, the pinned protocol version, the extension namespace, and the migration window, and marks the legacy chat-surface events as frozen.

## Decisions

1. **Direction: ACP server facade (option b), not our dialect with borrowed grammar (option a)** — user-approved lean (2026-08-28), adopted as the gate outcome; the head-to-head confirms it: the stable-ID retrofit is paid under *either* direction (option (a)'s block-id delta grammar cannot work with transient display IDs any more than replay can), mobile pays one migration either way (and (b) hands it a spec'd protocol with SDKs instead of a second bespoke dialect), e2e fixture churn is comparable — while (b) additionally collapses four reconnect mechanisms into resume replay, replaces ad-hoc extension fields with a governed convention, and keeps the door open to third-party ACP interop. Verified codebase facts contradict none of it. `hard-to-reverse`
2. **Freeze an ACP v2 stable-draft snapshot** — pin the spec repo at commit `d0370de50e16` (v2 `schema.json`, schema crate 1.7.0 line) as the conformance target; upstream drift becomes a tracked maintenance line, and deviations from the snapshot must name a concrete blocker. `hard-to-reverse`
3. **Stable item IDs become canonical** — derived from vendor identifiers (transcript UUIDs, tool-use IDs), identical across live stream, resume replay, and history reconstruction; transient generated IDs in the display pipeline are retired. Once a client consumes replay, IDs are contract. `hard-to-reverse`
4. **Open question (a) — literal UI Message Stream part compatibility: superseded** by Decision 1; the part vocabulary is ACP's, not Vercel's. `hard-to-reverse` (rides Decision 1)
5. **Open question (e) — start/delta/end triples vs patch semantics: patch** (ACP `ToolCallUpdate` grammar); patch handles revision, which `display.message.updated` actually needs, where triples only handle append. `hard-to-reverse` (rides Decision 1)
6. **Subagent attribution (open question d) lands here** — it is constitutive of the facade's subagent-as-tool-call representation and of retiring `task_group`; deferring it would mean shipping the old nesting on the new seam. `hard-to-reverse`
7. **Delta phasing (open question c): grammar all-kinds from day one, emission phased** — the wire grammar supports chunking/patching for every item kind immediately; token-granularity emission starts with text/reasoning (gated on partial-message adoption per AGENT-SDK-PARITY B4) with tool-input deltas following. `reversible`
8. **Migration (open question b): dual-surface coexistence** — facade endpoint beside the frozen legacy dialect; `initialize` on the new seam is the version negotiation; no dual-emit of new parts into the old dialect; legacy chat events removed only after desktop and mobile cut over. `reversible`
9. **Multi-client policy** (ACP leaves it unspecified): every attached client observes all session updates; gates broadcast; first responder wins; late answers are rejected as resolved — mirrors today's `permission.requested`/`permission.resolved` semantics. `reversible`
10. **Retry modeling**: `api_retry` becomes a content-replacing patch plus a namespaced retry marker, not a distinct lifecycle frame — patch semantics already express invalidation, so a new frame type would be redundant. `reversible`
11. **Queued prompts**: ordinary accepted prompts with queued-state metadata, cancellable pre-turn via standard cancellation — retires `queue.*` as protocol objects while the daemon keeps its internal CLI queue mirroring. `reversible`
12. **Gate presentation**: adapter-supplied ordered option lists with the client barred from inferring effects (borrow #4 in ACP-EVALUATION), rich answers as extensions — lets generic adapters, plan mode, and AskUserQuestion share one gate component without losing the differentiated answer surface. `reversible`
13. **Sync contract**: heartbeat plus resume-replay is the documented rule; refetch-on-gap is demoted from client heuristic to a spec'd fallback (resume with no cursor). `reversible`
14. **Throughput**: the daemon coalesces/throttles chunk emission server-side before fan-out (t3code's "too much data over websockets" warning); the throttle interval is an implementation choice, the coalescing guarantee is spec'd by criterion 3. `reversible`
15. **`ToolCallContent` carries the `diff` variant** — reverses the initial vendoring cut, which recorded v2's structured `DiffChange[]` shape only as a module comment; growth beyond v1's flat shape is a cost, not a blocker, and dropping it left the grammar able to say "an edit, at this path" (`ToolKind::Edit`, `locations`) but not what changed. Edit/Write results with structured hunks map to a `diff` content entry: `changes` plus git-patch text (the pinned doc's format: bare absolute paths, `/dev/null` pre-image for adds) for generic clients, with the legacy pipeline's hunks and before/after file text riding the diff's own `_meta["_mainframe.dev"]` (`StructuredDiff`) — neither survives a round trip through patch text, and the desktop Edit/Write cards consume exactly that shape. `reversible`
16. **`terminal` `ToolCallContent` stays out** — concrete blocker: the facade declines the `terminal/*` client services (Not Included), so a `terminalId` would reference a terminal no client can fetch state or output for. `reversible`
17. **`ContentBlock` stays text-only** — per-variant blockers: `image` has a producer (`LeafContent::Image`) but the delta engine accumulates exactly one text block per message item, so multi-block messages need block-indexed chunk grammar — the partial-message-phase lift (Decision 7); the `[image]` placeholder keeps replay coherent meanwhile. `audio`/`resource`/`resource_link` have no producer in any adapter pipeline — vendoring them would be dead grammar with no test path. `reversible`
18. **`RequestPermissionSubject` supports only the `tool_call` variant** — concrete blocker: every Mainframe gate originates from an adapter `ControlRequest` bound to a tool use (`gates.rs`), so the `command` subject (a bare shell command with no tool call) has no producer. `reversible`
19. **Gate resolution is pushed as `_mainframe.dev/gate_resolved`** — completes criterion 8's "resolution reaches every attached client": a `{sessionId, requestId}` notification goes to every connection still holding the delivered gate the moment it resolves (another facade client's answer, a legacy-surface answer, or CLI cancellation); the answering connection is excluded because its resolution rides its own response exchange, and resume redelivery stays the fallback for a client disconnected at that moment. A custom notification, not a `session/update` variant: gates are out-of-band on this facade, and their resolution is too. `reversible`
20. **Truncation rides the result text block's `_meta["_mainframe.dev"]`** — a daemon-truncated tool result marks its preview text block with `{truncated: true, fullBytes}` (the legacy `ToolCallResult` pair), restoring the on-demand full-output affordance on the facade path. Placed on the content block (which the schema reserves `_meta` on) rather than the tool-call item's `_meta`, because it describes that block's text, matching how Decision 15's diff fidelity rides the diff entry's own `_meta`. `reversible`
21. **Chat teardown reaches the facade as `ChatSurfaceEvent::ChatEnded`** — archive, end, and project removal announce teardown on the chat-surface seam; the hub drops the chat's gate-registry bookkeeping (`GateRegistry::forget_chat`, previously uncalled in production) and every connection's per-chat stream state and undelivered gates. No wire frame: teardown is daemon-internal hygiene; clients observe the chat's end through the existing turn/state grammar. `reversible`
22. **Content is block-indexed and `image` is vendored — supersedes Decision 17's image clause** (its `audio`/`resource`/`resource_link` clause stands: still no producer in any adapter pipeline). Decision 17 named the single-text-block chunk grammar as `image`'s blocker; this lifts the blocker itself rather than waiting for the partial-message phase, because `LeafContent::Image` producers exist today and desktop cannot cut over to the facade while images degrade to `[image]` placeholders. Message/thought items now carry an ordered `ContentBlock` list (`text` | `image`, the latter per schema `ImageContent`: base64 `data` + `mimeType`, optional `uri`). Chunk semantics follow the pinned schema exactly — `ContentChunk` carries one block and no block index (the schema has none; inventing a namespaced index would deviate for no producer need): a chunk appends to the item's list, a client coalesces a text chunk into a trailing text block, and the encoder guarantees losslessness by never emitting two adjacent text blocks (adjacent text leaves merge at encode). Only the tail block ever grows during streaming (display content is append-only mid-turn), so a text delta always addresses the tail; any non-tail revision — a retry rewriting earlier blocks — is a full-replacement upsert (Decision 10's path), never a chunk. `reversible`
23. **`--include-partial-messages` is adopted — supersedes Decision 7's emission-phasing clause and relaxes Decision 8's legacy freeze.** The Claude adapter passes the flag when a cached `claude --version` probe reports ≥ 1.0.109 (the flag's changelog introduction); an unknown, older, or unprobeable CLI omits it and the pipeline degrades to block-granularity emission — an unknown flag fails the spawn outright, so the gate is what turns "old CLI" into a degradation instead of an outage. `stream_event` text/thinking deltas (tool-input deltas stay deferred per Decision 7's tail) accumulate adapter-side, throttled to ~50ms, and merge into the shared display pipeline as a per-chat overlay: the facade's diff engine sees tail growth and emits true sub-message chunks, and the **legacy dialect emits the same finer-grained `display.message.*` frames** — per the user's direction (2026-08-28: "I don't care about mobile, it will need to be updated. Do everything properly."), Decision 8's byte-compatibility clause and criterion 12 are relaxed from a frozen cadence to frozen *shapes*; mobile updates in its own repo. The overlay is addressable before any block completes because Decision 3's derivation is refined: an assistant item's id is the API message id (`message.id`) claimed by the first event/entry of that message — known at `message_start` — with entry-uuid fallback for later blocks, applied identically live and in history reconstruction. An overlay aborted by a retry or interrupt vanishes from the snapshot and the diff engine emits a one-time content-clearing upsert (completing Decision 10's invalidation for mid-block aborts). `reversible`

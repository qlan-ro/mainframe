# Todo #275 — Codex first-message invisibility (a) and missing summarized titles (b)

**Date:** 2026-07-25
**Scope:** both parts of todo #275. Part (a) (first-turn invisibility) is the bulk — §1–§3. Part (b) (Codex `generateTitle`) is answered from source in §4; it needed no reproduction.
**Route:** research. No production code was written.
**Method:** live Codex `app-server` JSON-RPC tracing, an instrumented Rust daemon on an isolated port/data dir (`DAEMON_PORT=31555`, `MAINFRAME_DATA_DIR=/tmp/mf275/data`, `LOG_LEVEL=debug`), four WS/REST repro harnesses mirroring the app's first-send handoff, plus source reading of `packages/core-rs` and `packages/ui`.

**Citation convention.** Every claim below carries a `file:line` citation into the tree at this branch's merge-base, or sits under [Not established](#not-established) with what it would take to settle it. Line numbers were re-verified against the working tree on 2026-07-25.

---

## Verdict

**A real server-side defect is established. It is not established to be the reported bug. A rendered reproduction is required before any build decision.**

### Established

**The daemon never delivers `message.added` / `display.messages.set` for the first user message to the client that sent it.** The WS connection task handles inbound frames strictly serially (`packages/core-rs/crates/mainframe-server/src/websocket.rs:379`). The UI sends `message.send` *before* `subscribe` on a brand-new thread. The `message.send` handler blocks the connection for the entire Codex first-turn setup (`thread/start` + `turn/start`, measured 1.75–5.9 s), and the user message is appended and fanned out *inside* that window (`crates/mainframe-chat/src/chat_manager.rs:1821-1826`). `fanout` tests subscription membership **at emit time** (`websocket.rs:668-672`), and the client's `subscribe` frame is still unread — so both events are discarded for that connection, with no queue and no replay.

This is directly evidenced (§2), reproduced on both Codex and Claude, and is a genuine correctness defect in the daemon. It is worth fixing on its own merits.

### Not established — and this is the load-bearing gap

**That this drop is what the user sees.** Two independent reasons, both drawn from evidence already in this document:

1. **The dropped event is not what puts the first message on screen.** `sendMessage` dispatches the optimistic pending synchronously (`packages/ui/src/features/chat/controller/chat-thread-controller.ts:256`), the reducer stores it (`chat-thread-state.ts:404-411`), and the projection appends it unconditionally — `[...serverMessages, ...pendingMessages]` (`project-messages.ts:112-120`). With zero server messages the projection is exactly that one pending. The user's own first message is on screen from the moment they hit send, whether or not `message.added` ever arrives.

2. **The client's recovery fires, and succeeds, in every measured run.** Both the timely `subscribe:ack` and the 2 s fallback call `handleSubscribeAck`, which re-seeds whenever `hasUnreconciledPendings()` is true (`chat-ws-subscription.ts:133-135`) — and it is true here by construction. The re-seed is a REST `GET /api/chats/{id}/messages`, which reads the same in-memory store the send already appended to, ~75 ms in (§3c). Measured acks were 1754 ms, 1905 ms, 2424 ms, 5865 ms: the first two repair via the real ack, the last two via the fallback. No measured run leaves the pending unreconciled.

So the mechanism this research set out to confirm does not, on the evidence collected, produce the reported symptom. **The reported symptom itself was never observed in this investigation** — no Tauri window was driven, no rendered output was captured (see [Not established](#not-established)). What was reproduced is a daemon-side event drop that the client, as written, repairs.

### What this means for the build decision

- Fixing the fanout drop is defensible as **correctness work**, not as a fix for todo #275(a). Do not expect it to change what the user sees.
- Before building anything against the reported symptom, **reproduce it in a rendered client** — a live Tauri window, or a runtime test that drives the controller + projection and asserts on the projected message list. Until then the causal chain from "server drops two events" to "first message invisible" is unproven, and the candidate mechanisms in §3d are unexcluded guesses.

**Adapter-agnosticism.** A Claude control run reproduced the identical server-side drop with a 3 ms window, so the drop itself is not Codex-specific. *Hypothesis, untested:* if a user-visible variant exists, adapter latency would be the variable that decides whether the client's recovery wins the race. Nothing measured here confirms that — in all four Codex runs the recovery won.

**Same seam as the fixed "first message renders last" bug? Same family, different leg.** That fix made the client re-seed on a `subscribe:ack` conditionally, on one of three gap signals — `reconnect || isReattach() || hasUnreconciledPendings()` (`chat-ws-subscription.ts:133-135`). A clean first attach with no pending deliberately skips it, because the mount `load()` already seeded it and a re-seed there could clobber a live stream (docstring, `chat-ws-subscription.ts:42-45`). That fix closed the client-side gap; it did not close the server-side drop.

### Part (b) — settled, no reproduction needed

**Codex sessions never get a summarized title because neither runtime's Codex adapter overrides `generateTitle`.** The trait default returns `Ok(None)` (`crates/mainframe-adapter-api/src/adapter.rs:220-227`); Claude overrides it (`crates/mainframe-adapter-claude/src/adapter.rs:456-463`); the Codex crate has zero occurrences of `generate_title`, and the Node Codex adapter zero of `generateTitle`. The dispatch is already adapter-aware and already correct — it needs an implementation, not a fix. Full trace in §4, including one design constraint an implementer will hit: the title binary defaults to `"claude"` for *every* adapter (`crates/mainframe-chat/src/lifecycle_manager.rs:748-752`).

---

## 1. What the Codex app-server actually emits on the first turn

Raw JSON-RPC trace against `codex app-server` (codex-cli 0.144.3), `/tmp/mf275/trace.mjs`. Times are from process spawn.

| t (ms) | direction | message |
|---|---|---|
| ~60 | resp id=1 | `initialize` |
| ~60 | notif | (client sends `initialized`) |
| ~1600 | resp id=2 | `thread/start` → `{ thread: { id: "019f9664-…" } }` |
| ~1600 | notif | `thread/started` |
| ~1600 | notif | burst of `mcpServer/startupStatus/updated` |
| ~1750 | resp id=3 | `turn/start` → `{ turn: { status: "inProgress" } }` |
| ~1760 | notif | `thread/settings/updated`, `thread/status/changed` |
| ~2000 | notif | `turn/started` |
| ~2050 | notif | `warning` (skills budget) |
| ~4700 | notif | `item/started` + `item/completed` for a **`userMessage`** item |
| ~4900+ | notif | `reasoning` items, then the `agentMessage` |
| — | notif | `turn/completed`; usage arrives separately via `thread/tokenUsage/updated` |

Two things matter here:

- **The expensive part is `thread/start`, not the process spawn.** The daemon log shows the child up and ready 75 ms after chat creation (`/tmp/mf275/data/logs/server.2026-07-24.log:373-376`: `chat created` 22.778 → `chat session started` 22.853 → `user message sent` 22.853). Everything after that is the app-server's own first-turn latency.
- **Codex echoes the user's input back as an `item/completed` `userMessage`.** The daemon does not map it to a display message, so there is no accidental self-heal from that path. (Mapping it would create a duplicate user message, not a fix — noted only to rule it out.)

Nothing in the Codex protocol is missing or malformed. The first turn's events are emitted normally.

---

## 2. What the Rust daemon does with it

### 2a. The connection task is single-threaded over inbound frames

```rust
// crates/mainframe-server/src/websocket.rs:374-397
loop {
    tokio::select! {
        incoming = socket.recv() => {
            match incoming {
                Some(Ok(Message::Text(text))) => {
                    handle_text(text.as_str(), &ctx, &out_tx, &subscriptions, &mut file_watch).await;
                }
                …
```

`handle_text` is awaited **inline** (`websocket.rs:379`). Until it returns, this task cannot read the next inbound frame *and* cannot drain `out_rx` to the socket. Every frame from one client is serialized behind the slowest one.

`handle_text` → `handle_client_event` (`websocket.rs:403-420`, `422`). The `Subscribe` arm is what registers the client:

```rust
// websocket.rs:430-448
ClientEvent::Subscribe { chat_id } => {
    lock(subscriptions).insert(chat_id.clone());
    …
    send(out_tx, &DaemonEvent::SubscribeAck { chat_id });
}
```

### 2b. `message.send` blocks that loop for the whole Codex first turn

`ClientEvent::MessageSend` → `handle_message_send` (`websocket.rs:490-520`) → `ChatManager::send_message`, awaited at `websocket.rs:507-509`.

Inside `send_message`, in order:

1. spawn the session if needed — `lifecycle.start_chat(chat_id).await` (`chat_manager.rs:1680-1695`); ~75 ms for Codex;
2. **append + fan out the user message** — `chat_manager.rs:1821-1826`:
   ```rust
   .append(chat_id, message.clone());
   self.emit(DaemonEvent::MessageAdded { chat_id: …, message: message.clone() });
   self.event_handler.emit_display(chat_id);
   ```
   With an empty display cache `emit_display` produces `display.messages.set` (`crates/mainframe-chat/src/display_emitter.rs:33-38`);
3. deterministic title + `chat.updated` (`chat_manager.rs:1841-1882`);
4. **then** the slow part, still inside the same WS frame handler:
   ```rust
   // chat_manager.rs:1884-1890
   session
       .send_message(outgoing_content, processed.images.clone(), message_uuid.clone())
       .await?;
   ```
   For Codex that is the lazy `thread/start` (`crates/mainframe-adapter-codex/src/session.rs:467`) or `thread/resume` (`:450`), the second `on_init` with the real thread id (`:481`), and `turn/start` (`:528`).

So the events in step 2 are emitted **while the client's `subscribe` frame is still sitting unread in the socket buffer**.

### 2c. `fanout` gates on subscription membership at emit time

```rust
// websocket.rs:664-672
let is_global = CONNECTION_GLOBAL_EVENT_TYPES.contains(&type_name);
for entry in clients.iter() {
    let handle = entry.value();
    let deliver = is_global
        || match chat_id {
            None => true,
            Some(chat) => lock(&handle.subscriptions).contains(chat),
        };
```

`CONNECTION_GLOBAL_EVENT_TYPES` is only `chat.notification`, `permission.requested`, `automation.notification` (`websocket.rs:51-55`). `message.added` and `display.messages.set` are chat-scoped, so for a connection whose subscription set is still empty they are **dropped, not queued**. There is no replay: nothing re-emits them when the subscription is later registered.

This is why the events are *not* merely late. Global events (`process.ready`, `chat.updated`, the queued snapshot) are queued on `out_tx` and flush the moment the handler returns; the two chat-scoped first-turn events are gone.

### 2d. Measurements

Send-then-subscribe (the real app ordering, `/tmp/mf275/repro2.mjs`), Codex, three runs: `message.added` and `display.messages.set` carrying the user message **never arrived**. `subscribe:ack` latencies: **1754 ms, 1905 ms, 2424 ms** (a fourth run, cold model probe, ~5865 ms).

Subscribe-then-send (`/tmp/mf275/repro.mjs`, `MODE=client`), Codex: everything arrives correctly — `message.added` (user), `display.messages.set`, then the assistant stream. **Ordering is the whole difference.**

Claude control (`/tmp/mf275/repro3.mjs`), same send-then-subscribe ordering: `message.send` at t=21 ms, `subscribe` at t=21 ms, `subscribe:ack` at t=**24 ms** — and still **no `message.added` for the user message**; only the assistant's `message.added` / `display.message.added` at t≈3004 ms. A REST `GET /messages` at t=30028 ms returns both messages. **The server-side drop is therefore adapter-agnostic** — that part is measured.

*Hypothesis, not measured:* that Claude's 3 ms window is what keeps the drop invisible while Codex's seconds-long window does not. This never got tested, and the Codex measurements in fact cut against it — the client's re-seed repaired every Codex run too (§3c). Stated here only so the idea is recorded, not relied on.

### 2e. Why `resumeChat` does not repair it

`handleSubscribeAck` calls `resumeChat` first (`chat-ws-subscription.ts:123-125`). On the daemon side `LifecycleManager::resume_chat` (`crates/mainframe-chat/src/lifecycle_manager.rs:323-361`) does three things: it awaits `load_chat` (`:324`), it may re-spawn a dead session via `start_chat` when the chat is `Working` (`:345-347`), and it emits `ChatUpdated` (`:350-353`) plus `TodosUpdated` (`:355-360`).

What matters here is the omission: **none of those paths re-emit display state.** `load_chat` short-circuits for a chat already in `active_chats` (`lifecycle_manager.rs:370-371`), which a just-started chat is, so it is a no-op on this path and does not clobber the in-memory cache either. So `resumeChat` neither loses nor recovers the dropped messages — the REST re-seed is the only recovery.

---

## 3. What the UI does

### 3a. The subscribe lands after the send on a new thread

`onNew` (`packages/ui/src/features/chat/runtime/use-chat-thread-runtime.ts:138-147`):

```ts
if (!controller.hasRemoteId()) {
  const { remoteId } = await createForLocal(controller.getThreadId(), port);
  controller.setRemoteId(remoteId);
}
await controller.sendMessage(message);
```

`sendMessage` pushes the frame synchronously when there are no attachments (`packages/ui/src/features/chat/controller/chat-thread-controller.ts:263-268`).

The subscribe, by contrast, is an *effect*: `useChatThreadRuntime` opens the live sub only when `active` is true (`use-chat-thread-runtime.ts:108-112`), and `active` is derived as `mainThreadId === item.id && item.remoteId != null` (`packages/ui/src/features/sessions/runtime/use-chat-runtime-hook.ts:29-31`).

**`remoteId` here is an assistant-ui field, not the controller's.** `s.threadListItem.remoteId` is stamped by aui from the value `RemoteThreadListAdapter.initialize` returns (`packages/ui/src/features/sessions/runtime/chats-remote-adapter.ts:80-92`). `controller.setRemoteId` only mutates the controller; it does not write the aui thread-list entry. The two are separate seams that happen to agree on the id.

That distinction matters, because it means **the ordering is not guaranteed by construction.** The adapter's own header comment says so directly (`chats-remote-adapter.ts:14-21`): on first send *both* create seams fire — `onNew` and `initialize` — and they are made idempotent against each other "any ordering, not just the same-tick burst", precisely because which one wins is unspecified. An earlier draft of this document claimed the send "always wins" because `remoteId` only becomes non-null after `setRemoteId`; that reasoning is wrong and the conclusion is unsupported.

What *is* true, and is all that the measurements need: the subscribe is gated behind a React render + effect, so it cannot precede a send dispatched synchronously in the same callback. The controller additionally refuses to subscribe while the id is still `__LOCALID_*` (`chat-thread-controller.ts:112-131`). The observed repro ordering (send, then subscribe) is consistent with this, but it was measured, not proven.

### 3b. The optimistic pending renders the first message regardless of the drop

This is the finding that undercuts the original verdict, so it is worth being precise about.

`sendMessage` dispatches `local.message.queued` **synchronously**, before any network call (`chat-thread-controller.ts:256`). The reducer stores it in `pendingUserMessages` (`chat-thread-state.ts:404-411`). `projectChatThreadMessages` then appends every pending unconditionally:

```ts
// project-messages.ts:112-120
const pendingMessages: ThreadUserMessage[] = Object.values(state.pendingUserMessages)
  .filter((p): p is PendingUserMessage => p != null)
  .sort((a, b) => a.createdAt - b.createdAt)
  .map(projectPendingMessage);

return [...serverMessages, ...pendingMessages];
```

There is no gate on `serverMessages` being non-empty and no gate on load state. **With zero server messages the projection is exactly the one pending message.** So the user's first message is on screen from the moment they hit send, and the dropped `message.added` cannot be what makes it invisible.

What the drop *can* affect is **ordering**, not presence: pendings sort after server messages, so an unreconciled pending would render *below* an assistant reply that arrived first. That is a different symptom from the one reported ("invisible until you navigate away and back"), and §3c shows the pending does get reconciled anyway.

Pendings are cleared by `reconcilePendings` against confirmed **server** user messages — from a live `message.added` (`chat-event-router.ts:77-95`) or from `history.loaded` via `reconcilePendingAgainstHistory` (`chat-thread-controller.ts:239-244`). The live path is indeed dead here. The history path is not (§3c).

`reconcilePendings` matches on normalized text (`chat-reconcile.ts`), so a *later* turn's different text can never clear turn 1's stale pending. A pending that survives its own turn survives until the next re-seed.

### 3c. The re-seed fires and succeeds — the 2 s fallback repairs, it does not disarm

```ts
// chat-ws-subscription.ts:122-136
private handleSubscribeAck(reconnect: boolean): void {
  void resumeChat(…);
  this.restorePendingPermission();
  // …  - unreconciled pending: the first-message handoff gap.
  if (reconnect || this.host.isReattach() || this.host.hasUnreconciledPendings()) {
    this.host.onSubscribeRefresh();
  }
}
```

The docstring at `chat-ws-subscription.ts:30-46` already names this seam. `hasUnreconciledPendings()` (bound at `chat-thread-controller.ts:154`, inside `makeWsHost()`) is true in exactly our situation, so the ack path re-seeds. Verified: an ack-time `GET /api/chats/:id/messages` at t=2427 ms does return the user message (`/tmp/mf275/repro4.mjs`).

The fallback was the original suspect. It is not the defect:

```ts
// chat-ws-subscription.ts:106-120
this.ackFallbackTimer = setTimeout(() => {
  if (!this.awaitingAck || this.host.isDisposed()) return;
  if (!this.host.ws.connected) return;      // socket down → stay armed
  this.awaitingAck = false;
  console.warn('[chat-ws] subscribe:ack not received within timeout — resuming anyway');
  this.handleSubscribeAck(reconnect);
}, SUBSCRIBE_ACK_TIMEOUT_MS);               // 2000 ms — chat-ws-subscription.ts:16
```

**The fallback calls the same `handleSubscribeAck`**, so it too hits `hasUnreconciledPendings()` and re-seeds. The question is only whether the user message exists server-side at t=2000 ms. It does, and §2b is what proves it — the same ordering that causes the drop also guarantees the message is already stored:

| step | where | when |
|---|---|---|
| append to the in-memory store | `chat_manager.rs:1821` | before the slow send |
| emit `message.added` (dropped) | `chat_manager.rs:1822-1826` | before the slow send |
| `session.send_message().await` | `chat_manager.rs:1884-1890` | the 1.75–5.9 s block |

Per the daemon log (§1), the append lands ~75 ms after chat creation. The blocking call comes *after* it.

The re-seed reads that same store, over a path that is not blocked by the stalled WS task:

`GET /api/chats/{id}/messages` → `routes/chats.rs:143-149` → `get_display_messages` (`chat_manager.rs:1456`) → `get_messages` (`chat_manager.rs:1401-1413`), which returns the cached vector when it is non-empty. Its only gate is `lifecycle.await_loading` (`lifecycle_manager.rs:396-407`), which waits on the **load** guard — not the send. Nothing about the blocked WS connection task stalls an axum HTTP handler on a different task.

So a `GET` at t=2000 ms returns the user message. `onSubscribeRefresh()` → `refreshInBackground()` (`chat-thread-controller.ts:321-323`) → `refresh()` → `load(true)` (`:229-230`) → `history.loaded` + `reconcilePendingAgainstHistory` (`:214-215`, `:239-244`) → the pending is reconciled and the server copy is on screen.

**The fallback repairs the symptom. It does not disarm anything.** The earlier draft's claim that it "fires before the user message exists server-side" is contradicted by §2b of this same document. The error came from `repro4.mjs` only ever testing an *ack-time* GET (t=2427 ms); no fallback-time GET (t≈2000 ms) was ever run. That measurement gap is what let the wrong conclusion stand.

Across the four measured runs, every one repairs — acks at 1754 ms and 1905 ms via the genuine ack (both under the 2 s timer), acks at 2424 ms and 5865 ms via the fallback.

#### The one residual gap the fallback does leave

After the fallback fires, `awaitingAck` is false, so the genuine late ack is consumed without a second re-seed:

```ts
// chat-ws-subscription.ts:95-104
if (event.type !== 'subscribe:ack' || event.chatId !== this.host.chatId) return false;
if (this.awaitingAck) {            // ← already false
  …
  this.handleSubscribeAck(wasReconnect);
}
return true;                       // consumed, no re-seed
```

This matters for a narrower reason than the original draft claimed. The re-seed at t=2000 ms covers everything emitted up to t=2000 ms. But the subscription is not registered until the daemon actually reads the `subscribe` frame — t≈2424 ms in that run. **Chat-scoped events emitted in the window `(2000, 2424]` are dropped by `fanout` *and* fall after the only re-seed.** In the measured runs nothing user-visible lands there (the assistant's items start ~4700 ms, after the ack), so this stayed theoretical. It is the honest justification for recommendation C(i), and the only one.

`convert-message` is **not** implicated: it never receives the dropped events, so nothing in the display-message → `ThreadMessage` mapping can be at fault for them.

### 3d. Candidate mechanisms for the reported symptom — none excluded, none confirmed

With the fanout drop demoted to an adjacent defect, todo #275(a)'s actual cause is open. These are the unexcluded candidates, listed so the rendered reproduction knows what to look for. **All are unverified.**

- **A `history.loaded` wholesale replace landing stale.** The reducer's `history.loaded` arm rebuilds `messagesById`/`messageOrder` from scratch, with no staleness guard (`chat-thread-state.ts:220-242`). A snapshot older than events already applied would drop tail messages until the next event repaints. The first turn triggers a re-seed by construction, so this fires on exactly the reported turn.

  This candidate is broader than "a REST re-seed", and that widening is the part worth chasing: a **live** `display.messages.set` takes the same arm. `handleDaemonEvent` maps that event to `history.loaded` verbatim (`handle-daemon-event.ts:34-36`), so every full display set the daemon emits mid-turn wholesale-replaces client state. §2b establishes the daemon emits exactly that event for the first user message (empty display cache → `DisplayMessagesSet`, `display_emitter.rs:33-39`), and `emit_display_delta` re-emits a full set on any non-append change — id mismatch, shrink, or reorder (`display_emitter.rs:63-68`, `:69-74`, `:81-85`). A Codex turn that reorders or re-ids its display messages would therefore push full replaces through the client's most destructive path, live.

  **How often that fires on Codex is not established, and it is the single cheapest thing the next investigation could settle.** An in-tree comment asserts it fires constantly — "the Codex adapter regenerates every display id (nanoid) on each reconstruction, so it re-sets on essentially every turn of a live session" (`chat-event-router.ts:86-89`). That comment predates the Rust cutover and nothing here confirms it holds for the Rust daemon. Two facts point the other way: the display pipeline is adapter-agnostic (`chat_deps.rs:213-218` routes every adapter through the Claude `prepare_messages_for_client`, `display_pipeline.rs:31-68`, which derives display ids from the `ChatMessage` id), and Codex thread items carry protocol-supplied ids rather than generated ones (`thread_item_variants.rs`; the Codex crate's only `nanoid!()` calls are a session id at `session.rs:128` and an approval request id at `approval_handler.rs:66`). Settling this needs one measurement, not an audit: count `display.messages.set` frames on a live multi-turn Codex session. If the comment is right, this candidate is the prime suspect; if it is wrong, the comment is stale and should be deleted.
- **The `(re-seed, ack]` subscription window** above — events dropped and never re-seeded.
- **Something outside the controller entirely** — aui thread-list/runtime mounting, the `__LOCALID_*` → `remoteId` handoff in the projection consumer, or a render-level issue. §3a shows the two create seams have unspecified ordering; nothing here audited what aui does with the thread while that resolves.
- **A trigger this investigation never exercised.** The report is phrased generally ("first message in codex session not visible"), without naming a launch path — and the todo's own brief restates it generally too. Nothing here reproduced a user-visible failure at all, so the possibility that the real trigger is narrower than the repro (a specific launch config, a resumed chat, a worktree chat, a second session in the same window) is fully open. The rendered reproduction should start from the plainest path and widen only if it comes up clean.

---

## 4. Part (b) — why Codex sessions keep the truncated title

Settled by source reading alone. No reproduction was needed and none was run: the absence is total and mechanical.

### 4a. The title flow, end to end

On the first send, when the chat has no title yet (`chat_manager.rs:1841-1848`):

1. **Deterministic title first.** `derive_title_from_message(content)` is stored, persisted, and broadcast as `chat.updated` (`chat_manager.rs:1849-1863`).
2. **Then the LLM refine, spawned not awaited** (`chat_manager.rs:1869-1876`). The comment there records why: awaiting would stall the send and reorder the turn's events.
3. `do_generate_title` (`lifecycle_manager.rs:730-758`) resolves the adapter id from the chat, resolves the binary, calls the adapter, and on a non-`None` result updates the chat and emits `chat.updated` (`:759-772`).
4. `ChatManagerDeps::generate_title` looks the adapter up by id and calls its `generate_title` (`chat_deps.rs:548-570`).

Nothing in that chain is Codex-hostile. Step 3 already takes `adapter_id` and dispatches on it.

### 4b. The absence

| runtime | contract | Claude | Codex |
|---|---|---|---|
| Rust | `Adapter::generate_title`, default `Ok(None)` — `crates/mainframe-adapter-api/src/adapter.rs:220-227` | overrides — `crates/mainframe-adapter-claude/src/adapter.rs:456-463` | **no override** — zero occurrences of `generate_title` in `crates/mainframe-adapter-codex/` |
| Node | `generateTitle?(content, binary)`, optional — `packages/types/src/adapter.ts:374` | implements — `packages/core/src/plugins/builtin/claude/adapter.ts:246` | **not implemented** — zero occurrences of `generateTitle` in `packages/core/src/plugins/builtin/codex/adapter.ts` |

The trait default returns `Ok(None)`, and `Ok(None)` is indistinguishable at the call site from "generation ran and declined". So the deterministic title stands and nothing is logged. That is the whole bug: not a failure, an omission. The Rust daemon is the shipping one (Tauri default), so the Rust row is the load-bearing half; the Node row matters only for parity bookkeeping.

### 4c. Two constraints an implementer will hit

- **The title binary defaults to `claude` for every adapter.** `do_generate_title` reads the `provider.<adapterId>.titleBinary` setting and falls back to the literal `"claude"` when it is unset or empty (`lifecycle_manager.rs:748-752`). So a Codex chat with no `provider.codex.titleBinary` set would today invoke a Codex `generate_title` with `binary = "claude"`. Implementing (b) as "shell out to `binary`" without changing this default would have every Codex session spawn `claude` for its title. The acceptance criterion "honors the per-adapter title-binary setting" is satisfiable, but the *default* needs an explicit decision that the brief does not make.
- **The failure and disabled paths already behave as the acceptance criteria require, and need no new work.** `titleGeneration.disabled == "true"` returns before any adapter call (`lifecycle_manager.rs:734-741`); an `Err` from the adapter is logged at `warn` with the error and mapped to `None` (`chat_deps.rs:562-568`), leaving the deterministic title in place. Both criteria are pre-satisfied by the dispatch — a Codex implementation inherits them by returning `Err`/`None` rather than by adding handling.

### 4d. What (b) does not establish

The ghost-session criterion ("Codex title generation does not create a persisted session") is a **property of an implementation that does not exist yet**, so it cannot be verified here. What is known is the shape of the problem: the Codex session path persists by default — `thread/start` is sent with `persistExtendedHistory` and `persistFullHistory` both `true` (`crates/mainframe-adapter-codex/src/session.rs:464-465`), as is `thread/resume` (`:447-448`). Whoever implements (b) must establish that a one-shot title invocation can opt out of both, which this research did not test against the `codex` CLI. That is the one genuinely open question in part (b), and it is an implementation spike, not research.

---

## Answers to the brief's research questions

| brief question | answer |
|---|---|
| (a) Are the first Codex turn's events emitted live, or only surfaced on the reload/refetch path? | **Emitted live, then dropped.** The daemon emits `message.added` + `display.messages.set` for the first user message (`chat_manager.rs:1821-1826`) while the sender's `subscribe` frame is still unread, and `fanout` gates on subscription membership at emit time with no queue or replay (`websocket.rs:664-676`). They reach the client only via the REST re-seed. §2. |
| (a) Client-only fix, or must the daemon emit differently? | **The established defect is daemon-side** (§2), but it is *not* established to cause the reported symptom (§3b, §3c) — the client's optimistic pending renders the first message regardless, and the re-seed repaired every measured run. Answering "which side to fix" requires the rendered reproduction first. |
| (a) Is the drop Codex-specific? | **No.** A Claude control run reproduced the identical drop with a 3 ms window (§2d). Whether adapter latency decides *user-visibility* is a hypothesis, untested. |
| (b) Why do Codex sessions keep the truncated title? | **Neither runtime's Codex adapter implements `generateTitle`**; the trait default returns `Ok(None)` and the deterministic title stands. §4b. |
| (b) Is the daemon's dispatch already adapter-aware? | **Yes**, in both runtimes — it needs an implementation, not a change. §4a. |
| (b) Does the Rust daemon need separate work from Node? | **The Rust side is the only one that ships** (Tauri default). Both are missing it; only the Rust gap is user-visible. §4b. |
| (b) Can a one-shot Codex title invocation avoid a persisted session? | **Open.** Not tested. The Codex session path sets `persistExtendedHistory`/`persistFullHistory` true on both `thread/start` and `thread/resume` (`session.rs:447-448`, `:464-465`); whether a one-shot can opt out is an implementation spike. §4d. |
| (a) Priority — is (a) the critical part? | **Cannot be confirmed on this evidence.** (a)'s mechanism is unknown (§3d), so its severity is unknown. (b) is fully understood and shovel-ready. That inverts the brief's assumed sequencing. |

---

## Recommended fix direction

These options address part (a) only; part (b)'s direction is §4c plus the §4d spike.

**Step 0 — reproduce the reported symptom in a rendered client. Nothing below should be built first.**

The options below address the *established* defect (the fanout drop) and its neighbours. None of them is known to fix todo #275(a), because #275(a)'s mechanism is not known (§3d). Building A, B or C and shipping it as "fixes the invisible first message" would be a guess dressed as a fix.

The reproduction needs to be rendered, not transport-level: a live Tauri window on a Codex chat, or a runtime test that drives `ChatThreadController` + `projectChatThreadMessages` and asserts on the projected list. The four `/tmp/mf275` harnesses cannot show this — they observe WS frames, and §3b establishes that the on-screen first message does not come from a WS frame at all.

Cost estimates are rough, and are relative sizing for a build/no-build call rather than measured.

**A. Client — subscribe before the first send.**
In `onNew`, immediately after `setRemoteId(remoteId)`, call `controller.subscribeLive()` and keep the returned teardown, before `await controller.sendMessage(message)`. `subscribeLive` is ref-counted and idempotent (`chat-thread-controller.ts:112-131`), so the later `active` effect is a no-op increment and the existing teardown semantics hold. Repro run #1 shows subscribe-first delivers everything correctly, on both adapters.
*Rationale:* it sidesteps the aui `remoteId` gate entirely (§3a) by opening the sub from the controller directly, rather than waiting on a render + effect whose ordering against `initialize` is unspecified. Note this is a *different* rationale from the earlier draft's, which rested on an ordering guarantee that does not exist.
*Cost:* ~5–10 lines in one file, plus a test. Smallest of the three.
*Risk:* low-to-moderate. It introduces a second owner of the live-ref lifetime — the temporary ref must be released in a `finally`, or a failed send leaks a subscription. It does not fix the daemon's emit-time gate, so any other client (mobile, a future CLI) that sends before subscribing keeps the drop, and a reconnect mid-first-turn still loses events.

**B. Daemon — stop letting a slow chat-mutating frame block the connection's read loop.**
Handle control frames (`subscribe`/`unsubscribe`/`subscribeFile`) inline as today, but dispatch `message.send` onto a per-chat serialized task (a `tokio::mpsc` queue per chat, or a per-chat mutex + `tokio::spawn`) so `handle_socket` returns to `select!` immediately. Per-chat serialization preserves the send ordering that `ChatManager` relies on.
*Cost:* the largest by a wide margin, and the one the build/no-build call actually turns on. It is not a local edit: it needs a per-chat dispatch structure in `websocket.rs`, a new error-delivery path (errors from `send_message` currently ride back on the same frame handler, `websocket.rs:507-509`, and would become an explicit daemon event — so a new event variant in `@qlan-ro/mainframe-types` and a UI handler for it), and the per-chat (not global) ordering guarantee, or slow chats block fast ones. Expect it to touch the Rust daemon, the shared types package, and the UI event router together, with new tests at each layer.
*Risk:* high. It changes concurrency semantics for every chat-mutating frame, including paths this research never looked at (queued messages, permission replies, cancel). The ordering assumptions `ChatManager` makes are not documented anywhere and would have to be established first.
*Value:* it is the correct fix for the established defect, and the only one that protects non-Tauri clients. That value is real and independent of #275(a).

**C. Client — close the post-fallback re-seed gap.**
(i) Do not let the fallback permanently disarm the re-seed: track "fallback already fired" separately from `awaitingAck` and re-seed again when the genuine late ack arrives with unreconciled pendings (`chat-ws-subscription.ts:95-104`).
*Rationale (corrected):* not "the fallback re-seeds too early" — §3c shows it re-seeds successfully. The actual gap is narrower: the fallback's re-seed happens *before the subscription is registered*, so chat-scoped events emitted between the re-seed and the real ack are dropped by `fanout` and fall after the only re-seed. Re-seeding on the genuine ack closes that window, because that is the first moment the subscription is live.
(ii) Optionally, re-seed once when a run ends (`result`/`chat.updated → idle`) with pendings still unreconciled.
*Cost:* smallest, ~10 lines plus tests, one file.
*Risk:* low, but it makes re-seeds *more* frequent, which increases exposure to the wholesale `history.loaded` replace (`chat-thread-state.ts:220-242`) — itself a candidate cause in §3d. Adding a staleness guard there should be part of C, not deferred.
*Evidence:* the window C(i) closes was never observed to lose anything. It is a code-visible hole, not a measured failure.

**Recommendation.** Do not ship any of these as a fix for todo #275(a) yet. Take **B** to the backlog on its own merits as a daemon correctness defect, sized as above. Reserve **A** and **C** until the rendered reproduction says what actually breaks — if the cause turns out to be §3d's wholesale-replace candidate, A and C are the wrong layer entirely and would add risk without addressing it.

**Sequencing across (a) and (b).** The brief assumed (a) is the critical half and (b) the nicety. On this evidence that is inverted: (b) is fully understood, mechanically scoped, and blocked only on the one-shot-persistence spike (§4d), while (a) has no confirmed mechanism and no reproduction. Land (b) first; it is the part that can be built correctly today. The brief's own guidance — "keep together but land as two commits, (b) is shovel-ready now, (a) needs a live codex reproduction first" — holds, and this research is the reason (a) still does not have one.

---

## Incidental findings

- **The daemon masks Codex errors.** A chat created without a model makes the daemon omit `model` from `thread/start`/`turn/start`; codex 0.144.3 rejects it with `Invalid request: missing field 'model'`. The daemon logs the real error but sends the client a generic `"Internal error"` (`websocket.rs:490-520`). Worth surfacing the adapter's message.
- **v2 `thread/start` `sandbox` values are kebab-case** (`danger-full-access`), not the camelCase the `codex-protocol-debugger` skill's table implies for v2. `dangerFullAccess` is rejected: `unknown variant 'dangerFullAccess', expected one of 'read-only', 'workspace-write', 'danger-full-access'`.
- **Codex emits an `item/completed` `userMessage`** that the daemon does not map. Harmless today; mapping it would duplicate the user message rather than fix anything.

## Not established

Everything in this section is a gap, not a finding. Nothing here should be cited as evidence for a build decision.

- **The reported symptom itself.** No Tauri window was driven and no rendered output was captured, so "first message invisible until you navigate away and back" was never observed in this investigation. *To establish:* drive a live Tauri window on a new Codex chat, or write a runtime test over `ChatThreadController` + `projectChatThreadMessages` asserting on the projected list. This is the blocking gap — §3b shows the on-screen first message does not come from a WS frame at all, so no transport-level harness can close it.
- **That the established daemon drop causes the reported symptom.** §3b and §3c argue against it — the optimistic pending renders regardless, and the re-seed repaired all four measured runs. *To establish or exclude:* the same rendered reproduction, with the fanout drop present.
- **Which of §3d's candidate mechanisms is responsible.** Four candidates listed, none excluded, none confirmed. *To establish:* the rendered reproduction, then bisect by candidate.
- **Whether Codex actually triggers frequent full `display.messages.set` re-sets.** An in-tree comment says it does (`chat-event-router.ts:86-89`); the Rust display pipeline and Codex item ids suggest it may be stale post-cutover (§3d). *To establish:* count `display.messages.set` frames across a live multi-turn Codex session. One measurement.
- **That Claude's short window is what keeps the drop invisible.** Stated as a hypothesis in §2d and explicitly not relied on; the Codex measurements cut against it. *To establish:* vary adapter latency against a rendered client.
- **Whether the mobile client is affected.** It has its own subscribe/send ordering, not audited here. The server-side drop is client-agnostic, so it likely is — but that is inference, not evidence. *To establish:* audit the mobile subscribe/send ordering, or run the repro harness against it.
- **Whether `thread/start` latency correlates with anything controllable** (MCP server startup, model probe, cold cache). Observed 1.6–5.9 s across four runs; no attempt was made to isolate the driver. It matters only for how often the 2 s fallback loses the race. *To establish:* vary each input across repeated cold starts.
- **Whether a one-shot Codex title invocation can avoid persisting a session** (§4d). *To establish:* spike the `codex` CLI invocation and check for rollout artifacts.
- **The relative sizing of the fix options in [Recommended fix direction](#recommended-fix-direction).** Rough judgement from reading the call sites, not measured. *To establish:* spike option B's per-chat dispatch far enough to see what the error-delivery path costs.

## Reproduction assets

**The harnesses are not committed and live in `/tmp/mf275`, so they will be wiped.** The §2d measurements are therefore not independently re-verifiable from this repo — treat the numbers as reported, not as reproducible artifacts, and rebuild before relying on them. Rebuilding is cheap; the recipe below is the whole of it.

**Environment.** An isolated daemon: `DAEMON_PORT=31555 MAINFRAME_DATA_DIR=/tmp/mf275/data LOG_LEVEL=debug`, plus a scratch project registered via `POST /api/projects`. The production daemon on `:31415` was never touched, per the standing rule about launching against the real data dir.

**The harness.** ~30 lines of Node with the `ws` package. `POST /api/chats` with `{ projectId, adapterId: 'codex', model: 'gpt-5.5' }`, open one WebSocket, log every inbound frame with a millisecond offset, then drive the two frames in the order under test. The variants:

| harness | what it changes | what it showed |
|---|---|---|
| `repro.mjs` | `subscribe` **then** `message.send` | everything arrives correctly — the control |
| `repro2.mjs` | `message.send` **then** `subscribe`, both on the same socket (the real app ordering) | `message.added` / `display.messages.set` for the user message never arrive; ack at 1754/1905/2424 ms |
| `repro3.mjs` | same as `repro2`, `adapterId: 'claude'` | identical drop, ack at 24 ms — the drop is adapter-agnostic |
| `repro4.mjs` | `repro2` plus a `GET /api/chats/{id}/messages` fired from the `subscribe:ack` handler | the ack-time re-seed does return the user message |
| `trace.mjs` | speaks JSON-RPC to `codex app-server` directly, no daemon | the §1 protocol timeline |

**The gap in the harness set, stated plainly:** none of them fires a GET at t≈2000 ms, which is when the client's fallback re-seeds. §3c infers that GET would succeed from the daemon's ordering (`chat_manager.rs:1821` appends before the blocking `:1884` send), and that inference is sound — but it is an inference. A fifth variant with a fixed 2000 ms timer would settle it directly. That omission is what let an earlier draft of this document reach the wrong conclusion, so it is worth closing first if anyone rebuilds these.

Daemon log for the cited timings: `/tmp/mf275/data/logs/server.2026-07-24.log` (same caveat — ephemeral).

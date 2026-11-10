# Codex stream failure message and Reconnecting indicator (todo #406)

- Date: 2026-11-10
- Size: m · route: full
- Inputs: the approved Agent Brief and the binding `## Design direction` on todo #406.
- Scope: the observable behavior and acceptance criteria. The plan chooses the mechanisms.

## Problem

When OpenAI's response stream closes early, Codex retries for about 30 seconds: up to 5 attempts over WebSocket, then up to 5 more over HTTPS. Mainframe drops every one of those retry notifications, so the chat looks frozen. When the turn finally fails, the chat shows Codex's raw text, for example `stream disconnected before completion: stream closed before response.completed`. Nothing tells the user what happened or that retrying in the same chat may keep failing.

The daemon already has a provider-neutral retry signal: `SessionSink::on_api_retry`, which becomes `ChatSurfaceEvent::Retry` and then a `RetryMarker`. Claude feeds it today. The UI never renders it, and the marker only travels on the next content upsert, which never arrives while a reconnect is pending.

## Behavior

### 1. Retry signal from Codex

1. When Codex sends an `error` notification with `willRetry: true` for the session's own thread or a registered child thread, the adapter reports one retry through the existing retry path. Notifications for any other thread follow the existing ownership rules: they are dropped exactly as other foreign-thread notifications are.
2. Attempt and maximum come from Codex's own message, `Reconnecting... N/M`: the attempt is N and the reason includes M. When the error carries `additionalDetails`, the reason includes that text too.
3. Codex also sends `willRetry: true` with messages that carry no count. The known one is `Reconnecting... waiting for network`. It is still reported as a retry, with an unknown attempt, so the chat shows a reconnect instead of freezing.
4. An `error` notification with `willRetry: false` produces nothing. The `turn/completed` that follows already carries the failure, so the chat gets one error message, not two.
5. A malformed `error` notification is logged with `chat_id` and ignored. It never fails the session or the notification loop.

### 2. Reconnect status in the chat

1. While a retry is pending, the turn status row's phase word reads:
   - `Reconnecting (N/M)…` when the attempt and maximum are known. These are Codex's own per-transport numbers. Mainframe never adds them up across transports.
   - `Reconnecting (N)…` when only the attempt is known. This is Claude's case, because its retry event has no maximum.
   - `Reconnecting…` when the attempt is unknown or below 1.
2. The status appears while nothing else is streaming. It must not depend on a later content upsert to reach the client.
3. **Priority.** It replaces only Thinking, Writing and Working. `Needs your input`, `Stopping` and `Compacting` outrank it. When a higher phase ends while the retry is still pending, the reconnect status shows again.
4. **Tone and layout.**
   - The row's dot uses the warning colour.
   - The phase text keeps the normal phase-word colour. Warning-coloured text stays reserved for `Needs your input`.
   - The elapsed clock and the `N running tasks` segment stay where they are.
   - The row keeps its fixed height and never wraps to a second line.
   - Phase changes use the existing 180 ms phase morph and the existing minimum phase dwell. There is no new animation, and nothing moves under reduced motion.
5. **Hosting.** When a live activity group or a running tool row hosts the turn status and the row steps aside, the same reconnect text shows in that host's trailing status slot. The indicator never disappears mid-tool.
6. **Test id.** The element that carries the text has `data-testid="chat-retry-status-<chatId>"`, on whichever element currently hosts it. At most one such element exists per chat.
7. **Updates.** A later retry in the same turn replaces the shown numbers. For example, `2/5` becomes `3/5`, and after the HTTPS fallback the count restarts at `1/5`.
8. **Cleanup.** The status clears on whichever comes first:
   - new content streams for the turn, such as text, reasoning, or a tool call starting or updating
   - the turn completes
   - the turn fails
   - the user stops the turn
   The status never outlives its turn and never carries into the next one.
9. **Not persisted.** The status is transient. History, reload and resume replay never recreate a reconnect status for a finished turn. A client that attaches during a reconnect wait may miss the status until the next retry, and that is acceptable.
10. **Claude.** The status runs on the provider-neutral retry signal, so Claude's existing `api_retry` shows the same indicator without adapter changes. Claude keeps its existing behavior of discarding the aborted call's partial content on retry.

### 3. Lenient error metadata

1. Codex's turn error gains two optional fields: `codexErrorInfo` and `additionalDetails`.
2. `codexErrorInfo` is read leniently. Each of these decodes without failing the `turn/completed` or `error` notification:
   - the field is missing or `null`
   - a bare string variant such as `"serverOverloaded"` or `"other"`
   - an object variant such as `{"responseTooManyFailedAttempts":{"httpStatusCode":null}}`
   - an unknown string or an unknown object
   - an object with extra or missing inner fields
3. An unknown or unreadable value counts as no metadata, and the message falls back to its raw text.

### 4. Terminal failure headline

1. Envelope messages keep their current behavior. Any message that parses as an OpenAI JSON error envelope produces exactly the text #834 produces today, whatever `codexErrorInfo` says. The existing envelope tests pass unchanged.
2. A failed turn counts as a **stream failure** when either of these holds:
   - the message contains `stream closed before response.completed` or `stream disconnected before completion`
   - `codexErrorInfo` is `responseStreamDisconnected` or `responseTooManyFailedAttempts`
3. A stream failure renders as the headline, a blank line, then Codex's original message verbatim. The headline is:

   > OpenAI kept dropping the response and Codex gave up retrying. If this keeps happening in this chat, start a new chat or switch provider.

   The original message has no `OpenAI:` prefix, because the text comes from Codex and not from OpenAI.
4. **`serverOverloaded`.** Codex always sends `serverOverloaded` with `Selected model is at capacity. Please try a different model.` That message is already actionable, so it passes through unchanged as a single paragraph. If `serverOverloaded` ever arrives with different text, the capacity sentence becomes the headline, followed by a blank line and the original text. The capacity sentence is never reworded.
5. **`other`.** This is Codex's catch-all, used for hook failures, internal errors and stream errors alike, so it always gets a headline:
   - With stream text in the message, rule 2 applies and the stream headline from rule 3 shows.
   - With any other text, the message renders as this generic headline, a blank line, then Codex's original message verbatim:

     > Codex hit an error and could not finish this turn. If this keeps happening in this chat, start a new chat or switch provider.

     The generic headline does not say the response stream dropped, because `other` covers errors that have nothing to do with the stream.
6. Every other case, including unknown metadata, passes the raw message through unchanged, exactly as today.

### 5. Failed-turn card

1. The card stays the same destructive Alert. Its text is split at the **first** blank line:
   - The first part is the headline, in the card's current destructive text style.
   - The rest goes on its own line below, in `muted-foreground`, monospace, `xs`, and selectable.
2. There is no disclosure or expand control.
3. A message with no blank line renders exactly as today. This includes the capacity message and every raw passthrough.
4. The split is provider-neutral. Envelope messages from #834 (`headline` + blank line + `OpenAI: …`) get the same two-part rendering.
5. Several consecutive failures render as several cards in the same format.

## Out of scope

- Changing Codex's retry counts, or making Mainframe retry on its own.
- The upstream Codex bug that drops the Responses API `error` SSE event.
- Moving the conversation to a new chat or another provider automatically.
- Rewording any envelope case #834 already handles, or the capacity message.
- A combined `n/10` count across transports.
- A toast, banner or second status line.

## Acceptance criteria

- [ ] A `turn/completed` with status `failed`, message `stream disconnected before completion: stream closed before response.completed` and `codexErrorInfo: {"responseTooManyFailedAttempts":{"httpStatusCode":null}}` produces text that starts with the headline in Behavior 4.3, followed by a blank line and the original message verbatim.
- [ ] `codexErrorInfo` values `"serverOverloaded"`, `"other"`, an unknown string, an unknown object and `null` each decode without dropping the notification. The capacity message passes through unchanged under `"serverOverloaded"`, and `serverOverloaded` with other text gets the capacity headline. `"other"` with stream text gets the stream headline. `"other"` with unrelated text, for example a hook failure, gets the generic headline in Behavior 4.5, followed by a blank line and the original message verbatim. Unknown values stay raw.
- [ ] A stream-text message with no `codexErrorInfo` gets the stream headline.
- [ ] The existing `turn_error` envelope tests pass unchanged. An envelope message that also carries `codexErrorInfo` produces the same text as without it.
- [ ] The `error` notification `{"threadId":"t","turnId":"u","willRetry":true,"error":{"message":"Reconnecting... 2/5","codexErrorInfo":{"responseStreamDisconnected":{"httpStatusCode":null}}}}` makes a recording sink receive `on_api_retry(2, Some(reason))` with a reason that contains `5`. The same notification with `willRetry: false` reaches no sink method. `Reconnecting... waiting for network` with `willRetry: true` reports a retry with an unknown attempt. A foreign-thread `error` notification reaches no sink method.
- [ ] After a retry signal with attempt 2 and maximum 5, the chat shows `Reconnecting (2/5)…` under `chat-retry-status-<chatId>`. It disappears when the turn completes, when the turn fails, and when new content arrives.
- [ ] With only an attempt known, the status reads `Reconnecting (2)…`. With the attempt unknown, it reads `Reconnecting…`.
- [ ] While a permission is pending, the row reads `Needs your input`, not the reconnect status. `Stopping` and `Compacting` also win.
- [ ] While a live activity group or a running tool row hosts the status, the reconnect text and its test id appear in that host's trailing slot, and only once.
- [ ] The row's dot uses the warning colour and the phase text keeps the normal phase colour.
- [ ] The failed-turn card renders `headline\n\noriginal` as a headline line plus a muted mono line. A message with no blank line renders unchanged.
- [ ] The retry signal reaches the client while no content is streaming. A test sends a retry with no following upsert and shows the status arriving.
- [ ] Changed or new files stay within 300 lines and functions within 50 lines. The PR includes a changeset.
- [ ] `docs/research/adapters/codex/CONSUMED-SURFACE.md` gains or updates rows for the `error` notification and `TurnError.codexErrorInfo` / `additionalDetails`, marked schema-verified (codex-cli 0.163.0, `generate-json-schema`) and not live-verified.
- [ ] Visual evidence: the reconnect row and the two-part failure card, light and dark, driven by a fixture or mock, not a real failing stream.

## Decisions

1. **`other` always gets a headline. Only stream text earns the stream headline.** The brief requires a headline for every known variant, including `other`. Codex maps every unclassified error to `Other`, including hook failures, so a headline claiming OpenAI dropped the response would be wrong for most of them. `other` with stream text gets the stream headline. Any other `other` message gets a generic headline that says the turn failed and gives the same next step, with Codex's original text kept below it.
2. **`serverOverloaded` keeps the capacity sentence.** This follows the brief's out-of-scope line and the design direction. In practice the sentence is always Codex's text for this variant, so nothing changes. The headline form only covers unexpected text.
3. **Codex's original text has no `OpenAI:` prefix.** The format is still headline, blank line, original. The text is Codex's own, so labelling it as OpenAI's would misattribute it.
4. **Count-less reconnects still show a status.** `Reconnecting... waiting for network` shows as `Reconnecting…`. Dropping it would bring back the frozen look this todo fixes.
5. **The card split applies to every provider and every envelope.** #834's envelope messages already use the headline + blank line format, so they gain the muted second line too. Messages without a blank line are unchanged.
6. **The reconnect status is transient.** It is not persisted or replayed. It carries no lasting meaning after the turn.
7. **Recommended brief defaults taken as written.** The headline wording, Codex's per-transport `N/M` with no combined count, Claude parity, and inline placement with no toast.

## Receipts

- Codex source at `~/.agents/sources/codex` commit `3e9264f`; installed `codex-cli 0.163.0`.
  - `codex-rs/app-server-protocol/src/protocol/v2/notification.rs::ErrorNotification` has `{ error: TurnError, willRetry, threadId, turnId }`.
  - `codex-rs/app-server-protocol/src/protocol/v2/thread_data.rs::TurnError` has `{ message, codexErrorInfo?, additionalDetails?, misalignment? }`.
  - `codex-rs/app-server-protocol/src/protocol/v2/shared.rs::CodexErrorInfo` mixes unit variants (`serverOverloaded`, `other`, …) with object variants that carry `httpStatusCode` (`responseStreamDisconnected`, `responseTooManyFailedAttempts`, …).
  - `codex-rs/core/src/responses_retry.rs` emits `Reconnecting... {retry_count}/{max_retries}` and `Reconnecting... waiting for network`.
  - `codex-rs/protocol/src/error.rs` displays `ServerOverloaded` as `Selected model is at capacity. Please try a different model.`. Its `to_codex_protocol_error` maps unmatched details to `CodexErrorInfo::Other`.
- Mainframe:
  - `packages/core-rs/crates/mainframe-adapter-codex/src/notification_types.rs::TurnError` holds only `message` today.
  - `src/turn_error.rs::explain` produces `{headline}\n\nOpenAI: {message}` for envelopes.
  - `mainframe-acp/src/stream.rs::on_retry` attaches the marker only to the next content upsert.
  - `mainframe-adapter-claude/src/event_system.rs::handle_retry` reports `retryAttempt` with no maximum.
  - `packages/ui/src/features/chat/thread/turn-phase.ts::turnPhase` holds the phase priority.
  - `packages/ui/src/features/chat/messages/AssistantErrorBlock.tsx` renders the card.
- Overlap: open PR #898 (todo #425) touches Codex notification routing (`approval_handler.rs`, `session.rs`, `session_lifecycle.rs`). The plan should add the `error` handling as its own arm and leave those lines untouched.

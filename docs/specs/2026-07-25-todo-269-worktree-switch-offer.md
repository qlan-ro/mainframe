# Worktree switch offer — detect agent-created worktrees and offer to rebind the session

Source: todo #269 (spec, route:full). Design gate approved 2026-07-25: **variant B — banner pinned above the composer** (`proto/design-gates` @ `cee842ef`, `packages/ui/src/prototypes/worktree-switch/`). Variants A (anchored card), C (toast), D (quiet chip) were rejected. This spec defines behavior; the plan derives implementation from the seams cited here.

## Problem Statement

When an agent creates a git worktree mid-session — a Bash `git worktree add`, or the Claude CLI's `EnterWorktree` tool — Mainframe does not notice. The session keeps its original binding (`chat.worktreePath`/`branchName`), so diffs, launches, and the next restart all point at the old directory while the agent works in the new one. The only recovery is manual: the user must spot the tool pill and drive the composer WorktreePopover by hand.

Two worktree models exist and only one is in scope: the composer **WorktreePopover** rebinds *this* chat in place; the MainToolbar **BranchPopover** spawns a *separate* session (`use-worktree-session.ts` → `createChat`). This feature is the composer/session-rebind model only. The BranchPopover flow is untouched.

## Solution

The daemon watches each session's tool stream for worktree-related activity, rescans `git worktree list`, and raises a **switch offer** for any registered worktree that newly appeared. The UI shows the offer as a full-width banner pinned directly above the composer. Accepting rebinds the chat into the worktree using the existing attach machinery (stop CLI → relocate Claude session files → persist + broadcast → restart with `--resume`); declining dismisses that path permanently for the chat. Everything is additive: new WS event arms, two new chat-scoped routes, one new internal DB column.

### Detection (daemon, adapter-agnostic)

**A coarse trigger plus a git diff — no command parser.** Candidates never come from parsing shell commands; they come from observing that a new worktree got registered. This makes recall strictly better than any `git worktree add` parser (chained commands, scripts, Makefile targets, `xargs` all work if the command mentions worktrees) while git remains the sole source of truth for path and branch.

Seam: the `SessionSink` handlers in `packages/core-rs/crates/mainframe-chat/src/event_handler.rs`. Every adapter's normalized stream passes through this handler, so detection here is adapter-agnostic by construction. Triggers are stashed on `tool_use` and confirmed on the matching non-error `tool_result` (the existing `pending_file_paths` pattern; a failed command or failed `EnterWorktree` never triggers):

1. **Bash** (any adapter): a `ToolUse` named `Bash` whose `input.command` contains the substring `worktree` (case-insensitive).
2. **EnterWorktree** (Claude-only extra signal): any `ToolUse` named `EnterWorktree`. Its result JSON is **not** parsed — no field of it is load-bearing.

The sink stays synchronous and narrow: a confirmed trigger is handed off through **one** new `EventHandlerDeps` callback, exactly like the existing `on_pr_detected` → `add_detected_prs` seam. The callback itself is sync; the registry spawns its own async work from it. Known latency gap, accepted: subagent tool blocks (`on_subagent_child`) bypass the trigger scan, so a worktree created inside a subagent is caught by the next top-level trigger's rescan rather than immediately.

**The offer registry owns the rest.** A dedicated module in `mainframe-chat` (precedent: `context_tracker.rs`, `degraded_recovery.rs`, `plan_mode_handler.rs`; the crate already depends on `mainframe-services`) owns the whole offer lifecycle: the per-chat known-worktree baseline, the pending set, dismissed-set reads, verification, eligibility, event emission, the binding-change auto-resolve, and the in-flight switch guard. One owner holding one lock makes "one offer per path" a property of the registry, not of callback timing.

On a trigger, the registry rescans `get_worktrees(project_path)` (`mainframe-services/src/workspace/worktree.rs`) and diffs against the chat's baseline:

- **Baseline** — the set of registered worktree paths, captured **eagerly at chat activation (before the adapter spawns)**, so no trigger can precede it; after a daemon restart it is re-seeded at re-activation, not lazily. Defensive rule: if a trigger ever fires with no baseline present, that scan seeds the baseline and raises nothing. Worktrees already present at baseline are never offered.
- **Candidates** — every registered worktree new since the baseline. Canonical path and branch come from `git worktree list`; the registry strips `refs/heads/` to a **short name** (`get_worktrees` returns the raw ref; today only the UI strips it), `null` when detached.
- **Eligibility** — an offer is raised only when the canonical path is: not the main worktree, not the chat's current binding (canonical compare), not already pending, not in the chat's dismissed set, and **not another chat's current `worktreePath` in this project** (Mainframe-created worktrees — WorktreePopover, `fork-worktree`, automations — register in the same repo; offering chat B's worktree to chat A is a false positive, not a feature). Anything else is a no-op, satisfying the design's "no duplicate prompts" rule.
- **Pruning** — the same rescan resolves any *pending* offer whose path is no longer registered as `expired`, so a removed worktree's banner does not linger until a doomed accept.
- **Coalescing** — at most one rescan runs per chat at a time; triggers arriving mid-rescan collapse into at most one trailing rescan. This bounds the cost of the coarse substring match (in this repo, ordinary `ls`/`grep` commands mention `.worktrees/`): each burst costs one or two `git worktree list` invocations.

No new registered worktree → no offer. So `git worktree list|remove|prune|lock`, unrelated commands, and failed adds raise nothing, even when they trigger a rescan. `git worktree move` re-registers the worktree at a new path: the old path's pending offer (if any) expires via pruning, and the new path is genuinely new since baseline, so it may be offered — accepted behavior, no relocation special-case. Accepted consequence: a worktree the *user* creates in a terminal mid-session can be offered after the agent's next trigger — it is a real registered worktree and every eligibility gate still applies.

### The offer (type + transport)

One canonical type, defined in `@qlan-ro/mainframe-types` (`packages/types/src`) with a serde mirror in `packages/core-rs/crates/mainframe-types` (name avoids the existing welcome-screen `Suggestion`):

```ts
interface WorktreeSwitchOffer {
  chatId: string;
  worktreePath: string;       // canonical absolute path — the offer's identity
  branchName: string | null;  // short name (refs/heads/ stripped); null when detached
  detectedAt: number;         // epoch ms; orders the multi-offer list
}
```

There is no `source` field: nothing consumes it, and the diff cannot always attribute a creator anyway.

Three additive `DaemonEvent` arms (Rust enum in `mainframe-types/src/events.rs` + hand-written TS union in `packages/types/src/events.ts`, per the existing convention — there is no Zod for `DaemonEvent`):

- `worktree.offer.raised` — `{ chatId, offer }`
- `worktree.offer.resolved` — `{ chatId, worktreePath, outcome: 'accepted' | 'dismissed' | 'expired' }`
- `worktree.offer.snapshot` — `{ chatId, offers }`, emitted before `subscribe:ack` exactly like `message.queued.snapshot` (`mainframe-server/src/websocket.rs` `ClientEvent::Subscribe`), so a reloaded or reconnected client re-seeds pending offers.

All three are chat-scoped (fan-out already gates `chatId` events to subscribed clients; none join `CONNECTION_GLOBAL_EVENT_TYPES`). New event arms get the fixture round-trip tests the existing arms have (`docs/rust-port/fixtures/event.*.json` pattern). Mobile ignores unknown event types and fields — the contract change is additive.

### Offer state (daemon-owned)

- **Pending offers** live in the registry's memory per chat, keyed by canonical path. A daemon restart drops them — by design: "expiry is not dismissal," and re-creating the worktree prompts again (remove + add makes it new against the re-seeded baseline).
- **Dismissals** persist: a new internal `chats` column (JSON array of canonical paths, migration in `mainframe-db/src/migrations.rs`, repository method + tests). It is daemon-internal — not added to the `Chat` API payload, so the mobile contract is untouched. A dismissed path never prompts again for that chat, across restarts.
- **Resolution is single-sourced.** A pending offer resolves as `accepted` in exactly one way: the chat's binding changes to that path, by any route — the accept route below, or the user attaching via the WorktreePopover manually. The accept route itself never emits `resolved`; the binding change does, at the moment `chat.updated` persists. Named seam: `apply_worktree_update` is private to `ChatConfigManager`, so the notification reaches the registry through a new binding-changed hook on `ConfigManagerDeps` (alongside `emit_event`), fired wherever `apply_worktree_update` persists a new binding. `dismissed` is emitted by its route; `expired` by the accept route's vanished-worktree branch and by rescan pruning.

### Accept / dismiss (routes)

Two new chat-scoped routes in `mainframe-server/src/routes/worktree.rs` style (`parse_body` + hand validator mirroring Zod first-issue-wins, `ok`/`ok_empty`/`fail` envelope from `respond.rs`, inline route tests like the existing `mod tests`):

- `POST /api/chats/{id}/accept-worktree-offer` — body `{ worktreePath }`. Must match a pending offer (else 400). If a switch is already in flight for this chat, fail 409 "switch in progress" — the daemon-side guard that the UI's disabled buttons mirror. If the worktree no longer exists on disk, fail 400 and resolve the offer as `expired` (the path stays eligible — a vanished worktree must not poison it). Otherwise rebind (below); the binding change resolves the offer as `accepted`. If the rebind fails, the route fails with the error and the offer simply stays pending — it was never resolved, so no compensating re-raise exists.
- `POST /api/chats/{id}/dismiss-worktree-offer` — body `{ worktreePath }`. Must match a pending offer (else 400). Records the path in the persisted dismissed set, resolves as `dismissed`, returns `ok_empty`.

### The switch (rebind + restart)

Reuses the existing mid-session attach machinery (`ChatConfigManager::attach_worktree`, `config_manager.rs:434`): `stop_chat` (kills the CLI — this is what aborts an in-flight response) → for Claude, `move_session_files` between `get_claude_project_dir(old)` and `(new)` so `--resume` finds the transcript (Codex is assumed to need no relocation — verify at plan time) → `apply_worktree_update` (persists `worktreePath`/`branchName`, emits `chat.updated`) → `start_chat` (respawns with `--resume`; rejects if the worktree path is gone).

Required extensions:

1. **Worktree→worktree rebind.** Today `attach_worktree` early-returns when the chat already has a worktree (`if has_worktree { return Ok(()) }` — a silent no-op). The rebind path must support switching from one worktree to another: session files move from the chat's *current effective directory* (worktree or project root), not always from the project root. Target == current binding stays a no-op.
2. **Launch hygiene.** When rebinding away from a worktree, stop the launch processes bound to the old worktree, mirroring `disable_worktree`: call `stop_launch_processes(project_id, old_worktree_path)`. The signature fits as-is — verified: `ConfigManagerDeps::stop_launch_processes(project_id, effective_path)` is backed by `RegistryLaunchStopper` (`mainframe-server/src/chat_seams.rs`), which resolves `LaunchRegistry::get(project_id, path)` and calls `manager.stop_all()`; it accepts any path, so the worktree→worktree case just passes the old one. Scope note: it stops the whole `(project, path)` launch manager, not a per-chat subset — identical to `disable_worktree`'s blast radius.
3. **One switch at a time.** The registry holds a per-chat in-flight flag around the whole stop → move → persist → start composite; accept returns 409 while it is set. The existing `lifecycle_manager` single-flight guards cover `start_chat`/`load`/`interrupt` individually, not this composite — and this spec removes the `has_worktree` early-return that today incidentally suppresses re-entry, so the composite needs its own guard.
4. **Branch persistence.** Accept persists the short branch name; for a detached worktree it persists `branchName = null` (`apply_worktree_update` already accepts `None`; `attach_worktree`'s `branch_name: &str` parameter and the existing route's non-empty validation must be loosened to `Option` for this path). This deliberately diverges from the WorktreePopover's legacy `'detached'` literal: `null` renders through defined UI fallbacks instead of masquerading as a branch name, and it keeps the banner's pending and settled labels identical.
5. **Queued messages.** A mid-stream accept has the same queued-message semantics as any existing `stop_chat` → `start_chat` cycle: the CLI owns the queue and the daemon only mirrors `queuedRefs`; this feature adds no queue handling of its own. The plan should verify the mirror re-syncs after the restart — any gap there is a pre-existing property of the stop path, shared with the manual attach flow, not introduced here.

The switch persists like any other binding change (`chats` row), so it survives app reload and daemon restart.

### UI (approved design — variant B, honored exactly)

**Mount.** A `WorktreeSwitchBanner` rendered in `ChatThread.tsx`'s sticky `ThreadPrimitive.ViewportFooter`, between `BackgroundActivityBar` and `Composer` — directly above the composer, inside the chat column, never covering the transcript (footer height already registers as scroll inset). Not a toast, not a modal, not attached to the tool pill. It persists until answered. Renders nothing when there are no pending offers and no switch in flight. Draft (`__LOCALID_*`) threads have no daemon chat and therefore no offers.

**State** flows through the controller, not React: new arms in `handle-daemon-event.ts`/`chat-event-router.ts` map the three events into `state.worktreeOffers` on the chat thread state (precedent: `backgroundTasks`); the component reads `useChatExtras()`. The acting client additionally tracks a local in-flight accept (chat + target path) — set on POST, cleared when `state.chatConfig` (server-authoritative, mirrored from `chat.updated`) reports the target `worktreePath` or the POST fails. Pure derivation stays in the controller/reducer with tests.

**States** (copy verbatim from the approved prototype — the restart warning is load-bearing, do not trim):

1. *Pending, one worktree* — container `rounded-lg border border-primary/40 bg-primary/10 p-3`. Headline `text-body font-medium` with `GitBranch` `size-3.5 text-primary`: `New worktree: {branch}`. Body `text-caption text-muted-foreground`: **"Created at {path}. Switch this session into it? The agent restarts in the new folder — a running process can't change directory. History carries over; a response in progress stops."**
2. *Pending, two or more* — one banner collapses into a list: title `{n} new worktrees — switch this session?`, shared warning once — **"Switching restarts the agent in the chosen folder — a running process can't change directory. History carries over; a response in progress stops."** — then one `rounded-md bg-card/60 px-2 py-1.5` row per worktree (branch `text-caption font-medium`, path `font-mono truncate text-muted-foreground`) with its own buttons, ordered by `detectedAt`. Never stack two full banners.
3. *Switching* — a single status line, `Loader2` spinning `size-3.5 text-primary`: `Switching — restarting the agent in {branch}…`, container `border-primary/40 bg-primary/10`. With one pending offer the whole banner is the status line. With two or more, **only the accepted row** becomes the status line; the other rows stay visible with their accept buttons disabled (mirroring the daemon's 409 guard) and their dismiss buttons enabled.
4. *Settled* — `Check size-3.5 text-mf-success`, container `border-mf-success/40 bg-mf-success-tint`: `Session is now in {path} on {branch}.` Shown on the acting client only, driven by its in-flight accept completing; it removes itself after ~2 s — the session header's branch indicator is the durable record. Other subscribed clients simply see the offer leave the banner when `worktree.offer.resolved` arrives, the same way a dismissal looks.

`{branch}` falls back to the worktree path's basename whenever `branchName` is null (detached) — in every state, including *Settled* (whose `chatConfig.branchName` is also null, per the persistence rule above).

**Actions.** Primary **Switch session** (`bg-primary text-primary-foreground px-2.5 py-1 text-caption font-medium hover:bg-primary/90`, testid `worktree-switch-accept`); secondary **Stay here** (`border border-border px-2.5 py-1 text-caption text-muted-foreground hover:bg-accent hover:text-accent-foreground`, testid `worktree-switch-dismiss`). Both carry `data-path` with the offer's canonical path. Banner container: `worktree-switch-banner`; list rows: `worktree-switch-row` + `data-path`; status line: `worktree-switch-status`.

**Flow.** Accept → POST accept → the accepted offer shows *Switching* → when `state.chatConfig` reports the target `worktreePath` (no optimistic edit), show *Settled*, then remove after ~2 s. Accept works mid-stream — the copy already warns that the in-flight response stops; no second confirmation. Accept failure (including 409) → the offer stays pending, the in-flight flag clears, and the error surfaces via `mfToast`. Dismiss → POST dismiss → the `resolved` event removes the offer (in every connected client). Real `mf-*` tokens only; `bg-mf-success-tint` and `text-mf-success`/`border-mf-success` are existing tokens (the prototype rendered with them).

**The manual door.** The design's transience — permanent dismissal, no undo, no dismissed-offers list — rests on the WorktreePopover remaining "the manual door into any worktree." Today that door does not exist for already-isolated chats: `WorktreePopover.tsx` renders `ActiveInfo` (no Existing tab, no attach action) when `isIsolated`. In scope: for an already-isolated chat, the popover keeps offering the existing-worktree list, attaching via the same worktree→worktree rebind this spec adds (existing tab testids preserved). This repairs the approved design's premise rather than shipping it false; it adds no new UI surface — the Existing tab already exists for non-isolated chats.

## Acceptance criteria

Detection (offer-registry unit tests + sink handoff tests):

1. A completed, non-error Bash tool call whose command contains `worktree` and which registered a new worktree raises exactly one `worktree.offer.raised` carrying the canonical path and the short branch name from `git worktree list` (never a `refs/heads/…` string).
2. A completed, non-error `EnterWorktree` that created a worktree raises the same offer via the rescan diff; its result JSON is never parsed.
3. `git worktree list|remove|prune|lock`, unrelated commands, and failed (`is_error`) tool results raise nothing — the rescan may run, but the diff yields no new worktree. A `git worktree remove` expires any pending offer for the removed path; a `git worktree move` expires the old path's pending offer and may raise one for the new path.
4. A candidate that is not registered in `git worktree list` at rescan time (deleted before the result, unrelated repo) is dropped without an event.
5. No offer is raised for the main worktree, the chat's current binding, an already-pending path, a dismissed path, another chat's current `worktreePath` in the project, or a worktree already present at the chat's baseline (captured at activation, re-seeded on re-activation after a daemon restart) — including when the agent touches the worktree again.

Switch and persistence:

6. Accepting rebinds the chat (`chat.updated` carries the new `worktreePath`/`branchName`), restarts the CLI in the new directory with history resumed, and the binding survives an app reload and a daemon restart. A single `worktree.offer.resolved{accepted}` is emitted per accepted offer — by the binding change, never by the route.
7. Accepting while a chat already sits in a different worktree performs the worktree→worktree rebind (no silent no-op), relocating Claude session files from the old worktree's directory.
8. Accepting mid-stream stops the in-flight response; the restart proceeds without further confirmation. Queued messages follow the existing `stop_chat` → `start_chat` semantics unchanged (extension 5); this feature neither drops nor re-orders the daemon's queue mirror.
9. Rebinding away from a worktree stops the launch processes bound to `(project, old worktree path)`, mirroring `disable_worktree`.
10. A failed rebind leaves the offer pending (no `resolved` event fired); accepting a vanished worktree fails 400 and resolves the offer as `expired`; a rescan resolves pending offers for no-longer-registered paths as `expired`; accepting while a switch is in flight fails 409.
11. Dismissing resolves the offer everywhere, persists the path in the chat's dismissed set (daemon-restart-proof), and never re-prompts for it; a dropped-not-dismissed offer (daemon restart) re-prompts when the worktree is re-created. Accepting a detached worktree persists `branchName = null`.
12. Both routes validate their bodies (first-failing-issue error messages), return the standard `success` envelope, reject unknown/non-pending paths with 400 and in-flight switches with 409, and have route tests; the new DB method has repository tests; new event arms have fixture round-trip tests.

UI (component + reducer tests; single-file vitest runs):

13. The banner renders each designed state — pending single, pending list (n ≥ 2, one shared warning, `detectedAt` order, never stacked banners), switching (row-level for n ≥ 2 with other accepts disabled and dismisses enabled), settled-then-removed — with the exact copy above, including both restart warnings verbatim.
14. `worktree-switch-accept`, `worktree-switch-dismiss`, `worktree-switch-banner`, `worktree-switch-row`, `worktree-switch-status` testids exist; buttons and rows carry `data-path` keyed by the offer's path.
15. A reloaded client re-seeds pending offers from the subscribe snapshot; a `resolved` event from another client removes the offer locally; the banner renders nothing for draft threads and for chats with no pending offers and no switch in flight.
16. The WorktreePopover on an already-isolated chat offers the existing-worktree list; attaching from it performs the same rebind (observed via `chat.updated`), with the tab's existing testids preserved.

## Out of Scope

- Creating worktrees from the offer, branch pickers, or any worktree-creation UI (WorktreePopover already owns that).
- Auto-switching without confirmation; "switch and keep streaming" (a running process cannot chdir).
- `ExitWorktree` handling, worktree removal/cleanup.
- The MainToolbar BranchPopover / separate-session model, and the `DegradedChatCard` worktree-missing recovery flow.
- Codex `EnterWorktree` parity (no such tool); the Bash path covers all adapters by construction.
- Mobile UI for the offer (events are additive; mobile may adopt later).
- An e2e scenario: the mock adapter's committed recording (`worktree-pills.0.ndjson`) replays the tool stream, but no worktree exists on disk, so the rescan diff would (correctly) find nothing. Coverage lives in unit/component tests; a live-repo e2e can follow separately.

## Decisions

Brief's open questions (recommended answers adopted unless noted):

1. **When to prompt** — once per unique canonical worktree path, on either signal; duplicates and re-touches are no-ops. (As recommended.)
2. **What "switch" means** — rebind `worktreePath`/`branchName` and restart the adapter; the copy states it. (As recommended; the attach machinery already implements stop → move → restart.)
3. **Move vs spawn** — move (rebind) the current session. (As recommended; matches the composer model.)
4. **EnterWorktree scope** — Bash detection is adapter-agnostic; EnterWorktree is a Claude-only extra signal. (As recommended — strengthened: detection lives in the chat-layer event handler, so adapter-agnosticism is structural, not per-adapter work.)
5. **Persist dismissal** — yes, per chat per canonical path, in a new internal DB column so it survives daemon restarts. (As recommended; "permanent per path" from the design gate demands durability.)

Rulings made in this spec (no user gate — surface in the run report):

6. **Detection seam** — the sink stashes coarse triggers and hands confirmed ones through one new sync `EventHandlerDeps` callback (precedent: `on_pr_detected` → `add_detected_prs`); a dedicated offer-registry module in `mainframe-chat` (precedent: `context_tracker.rs`) owns the async work and all offer state. The sink stays synchronous and narrow.
7. **No command parser** — the brief's `git worktree add` parser is replaced by trigger + baseline diff of `git worktree list`. The spec's own authority rule made the parser's output dead on arrival, and the diff has strictly better recall (scripts, chains, Makefiles). EnterWorktree's result JSON is not parsed; no field of it is load-bearing.
8. **Transport** — three additive `worktree.offer.*` event arms modeled on the `message.queued.*` family, with the snapshot emitted before `subscribe:ack` (existing precedent) so reloads re-seed pending offers.
9. **Routes** — `accept-worktree-offer` / `dismiss-worktree-offer`, kebab verbs matching `enable-worktree`/`attach-worktree`; offers are addressed by `worktreePath` (the design already makes the path the identity).
10. **Single resolution** — the accept route never resolves; the binding change emits the one `resolved{accepted}`. A failed rebind leaves the offer pending — no compensating re-raise, no double emit.
11. **Worktree→worktree rebind** — extend the attach path rather than add a parallel one; the current early-return no-op would make accept silently fail for already-isolated chats.
12. **Vanished worktree on accept** — fail 400 and resolve as `expired` (path stays eligible), never as `dismissed`.
13. **Concurrent accepts** — the daemon guards the switch composite per chat and returns 409; the UI's disabled accept buttons mirror that guarantee rather than being the only guard.
14. **Accept failure** — offer stays pending + `mfToast` error; the design defines no banner error state and the manual door (ruling 17) exists.
15. **Settled removal** — ~2 s after the settled line on the acting client, then unmount (design says "then the banner removes itself" without a time; 2 s is the testable reading). Other clients see the offer removed on `resolved`, like a dismissal.
16. **Branch shape** — offers carry short branch names (`refs/heads/` stripped, per every existing consumer); a detached accept persists `branchName = null` (diverging from the popover's legacy `'detached'` literal) so pending and settled labels agree via the same basename fallback.
17. **The manual door is scoped in** — the WorktreePopover's existing-worktree list stays available for already-isolated chats, backed by the same rebind extension. This exceeds the todo's acceptance criteria (it changes a shipped surface for every isolated chat), and it is kept deliberately: the approved design's transience — permanent dismissal, no undo — rests on this door existing, and today it does not for exactly the chats this feature targets. The spec repairs the premise instead of recording it false. This is the ruling most worth a user look.
18. **No `source` field** — dropped from the brief's suggested type; nothing consumes it and the diff cannot always attribute a creator.
19. **Unbound external worktrees may be offered; other chats' worktrees may not** — a worktree the user creates in a terminal mid-session may be offered after the agent's next trigger (every eligibility gate still applies; dismissal is one click). A worktree that is another chat's current binding is excluded by an eligibility gate: Mainframe itself registers worktrees in the same repo (WorktreePopover, `fork-worktree`, automations), and offering chat B's worktree to chat A is a false positive.
20. **Launch processes** — rebinding away from a worktree stops the launches bound to `(project, old worktree path)`, mirroring `disable_worktree`; verified that the existing `stop_launch_processes(project_id, path)` seam (`RegistryLaunchStopper` → `LaunchRegistry::get` → `stop_all`) needs no signature change.
21. **Baseline timing** — captured eagerly at chat activation, before the adapter spawns, and re-seeded at re-activation after a daemon restart; a trigger with no baseline seeds it and raises nothing. A lazily seeded baseline would swallow the first offer of every session (the first trigger's scan would already contain the new worktree).
22. **`git worktree move`** — no relocation special-case: the old path's pending offer expires via rescan pruning and the relocated worktree may be offered at its new path. Distinguishing a relocation from a creation would need state git does not provide, for a marginal case.
23. **Queued messages on mid-stream accept** — inherit the existing `stop_chat` → `start_chat` semantics unchanged; the feature adds no queue handling. Any mirror-resync gap after a CLI kill is a pre-existing property of the stop path, shared with the manual attach flow.

## Open items

None. The one previously flagged fact — the stability of `EnterWorktree`'s result JSON — is moot: detection no longer reads it (ruling 7).

# Implementation plan — Smart Actions in chat: instruction chips (#278) + localhost tunnel chips (#279)

**Spec (the contract):** `docs/specs/2026-07-25-todo-278-smart-actions.md` (@ `1d0583ec`). Its Decisions section is settled; this plan implements it, it does not reopen it.
**Worktree:** `/Users/doruchiulan/Projects/qlan/mainframe/.worktrees/todo-278-smart-actions`, branch `todo/278-smart-actions`. All paths below are relative to the worktree root. All cargo commands run from `packages/core-rs/`.
**Revision:** rev 2, after the thermo-nuclear plan review (`NOT APPROVED`). Every B/M/minor finding is folded into the tasks below; the two review claims that did not survive verification are recorded in "Review findings reversed" at the end.

**Goal.** One PR, one inline-chip mechanism inside assistant markdown, two detectors: (#278) a slash-instruction chip that appends the instruction to the composer or opens a prefilled draft session, gated on the per-chat skills catalog; (#279) a localhost-URL chip that opens directly on a local daemon and, on a remote daemon, starts a Cloudflare quick tunnel for the port via a new Rust route family `/api/tunnel/ports/*`, with WS-driven state, scope-release teardown, and an "Active port tunnels" list in the remote-access pane. Detection is pure logic in `@qlan-ro/mainframe-types`; rendering is a remark plugin that splices one custom node for prose tokens plus render-time branches in the existing component overrides; the #279 daemon work stays independently revertible (separate commit group).

---

## Ground rules for every task

- **No full `pnpm install` unless `packages/mobile` is present.** The submodule is absent in this worktree; a full install strips its importer and rewrites `pnpm-lock.yaml` with thousands of deletions. Task 1 fixes the environment first. If `git diff --stat pnpm-lock.yaml` ever shows a mass deletion: `git checkout -- pnpm-lock.yaml` and stop.
- **No `pnpm install` after the fan-out.** Task 1 is the only task that installs or edits `packages/ui/package.json`. Once T5–T17 run in parallel, an install would rewrite `node_modules` under a live `vitest`/`tsc` and race the lockfile guard rail above.
- **One cargo build at a time.** Cargo takes an exclusive lock on `packages/core-rs/target`, so the Rust track is strictly sequential (T5 → T6 → T7 → T8). The Rust track and the UI tracks may run concurrently — different toolchains, no shared files.
- **Test commands:** single UI test file via `pnpm --filter @qlan-ro/mainframe-ui exec vitest run <file>` (never large multi-suite runs — cross-file `React.act` failures); `pnpm --filter @qlan-ro/mainframe-ui typecheck`; types package via `pnpm --filter @qlan-ro/mainframe-types test`; Rust via `cargo test -p <crate>` from `packages/core-rs/`. `cargo fmt` is enforced by a pre-commit hook — run `cargo fmt` before finishing any Rust task.
- **Code rules baked in:** ≤300 lines/file, ≤50/function (decompose — `markdown-text.tsx` is at 286 lines, see Task 11); `data-testid` on every interactive element; no silent catches (UI catches log via tagged `console.warn` or surface `mfToast.error`); single canonical type in `packages/types`; tests required for new routes/core logic; no `@ts-ignore` (module augmentation or `@ts-expect-error` + reason); parse JSON defensively in API clients (the `remote-access.ts` guard style).
- **Do not commit or push.** The orchestrator owns commits. `docs/plans/` is gitignored; verify this file with `git ls-files`, never `git status`.
- **Commit/revert grouping** (for the orchestrator): #278 group = Tasks 2–3 (`smart-actions/instructions.*` files), 9–13. #279 group = Tasks 2–3 (`smart-actions/port-tunnels.*` files), 5–8, 14–17. Shared = Tasks 1, 18, 19. The #279 Rust tasks (5–8) must be their own commits so the daemon arm reverts cleanly. The types split is **structural, not by hunk** (Task 3), so both groups are whole-file adds.

## Architecture decisions taken by this plan

These resolve points the spec left to implementation. Verified against the code at `1d0583ec` and against the installed library sources (paths given inline — re-verify only if a dependency version moves).

1. **Scope teardown = explicit deps seam, not a bus subscriber.** A new `stop_scope_tunnels(project_id, effective_path)` seam is added next to `stop_launch_processes`, awaited at the scope-release site in `crates/mainframe-chat/src/lifecycle_manager.rs:594-601` **before** the `LaunchScopeReleased` emit. Rationale: it mirrors the existing `LaunchStopper`/`NoopLaunchStopper` pattern (`crates/mainframe-server/src/chat_seams.rs:26-87`), it gets deterministic `FakeDeps` tests for free (the three existing scope-release tests at `lifecycle_manager.rs:1160-1220`), and a bus subscriber would need scope metadata the `TunnelManager` label map does not carry. The seam fires only at this lifecycle site; the `config_manager.rs:520` worktree-config-change path is a launch-restart concern, not a scope release, and does not stop port tunnels. **Consequence, ruled by the user on 2026-07-25: see "Under-specified points" #1.**
2. **Scope metadata and single-flight live in a new `PortTunnelRegistry`** (`crates/mainframe-launch/src/port_tunnel_registry.rs`) wrapping `Arc<TunnelManager>`. `TunnelManager`'s `tunnels`/`ManagedTunnel` are private, have no list API and no scope field, and `start` kills-and-respawns its label — so the route-level dedupe, the in-flight start registry, the ownership metadata, and `GET` listing all live in this one struct. **Invariant: the registry never spawns cloudflared itself.** Every spawn goes through `TunnelManager::start`, which owns the lifelong stdout/stderr drain (`tunnel_manager.rs:376`); a registry that spawned its own child would SIGPIPE-die after ready (the incident recorded in this repo). `TunnelManager` is not modified.
3. **The registry mirrors state it does not own, so every read of a `Ready` entry is liveness-checked.** `TunnelManager::spawn_exit_watcher` (`tunnel_manager.rs:469-497`) removes the label and broadcasts `Stopped` when cloudflared dies; the registry is not a subscriber and would otherwise hand back a dead URL forever. Both `start`'s ready fast path and `list` re-check `manager.get_url(label)` and drop a stale entry (Task 5).
4. **The port rides in the label — `port:{port}` — and `tunnel:status` is not widened.** The TS payload (`packages/types/src/events.ts:81-88`) and Rust enum (`crates/mainframe-types/src/events.rs:311-321`) keep their shape; the UI parses the label prefix via shared helpers in `packages/types/src/smart-actions/`. Avoids touching a wire type consumed by mobile and the remote-access pane.
5. **The daemon's own port is served by the daemon, not guessed by the client.** `GET /api/tunnel/ports` returns `{tunnels, daemonPort}`. `useDaemonPort()` cannot answer this: on a remote target reached through a portless `https://…trycloudflare.com` base URL, `packages/ui/src/app/App.tsx` (`DaemonGatedShell`) computes `urlPort = 0` and falls back to the **local** daemon's port (31415, or 31500 under `App Tauri Preview`), and `GET /health` carries `{status, version, pid, timestamp, tunnelUrl}` only (`crates/mainframe-server/src/routes/health.rs`) — no port. Without this the remote case (the only case #279 exists for) chips a link the route then rejects, and decision 10's choke point toasts an error for a link that should never have been chipped. The client stores `daemonPort` next to `byPort` and uses `useDaemonPort()` only as the pre-seed fallback. The route keeps its `port != ctx.port` rejection (defence in depth; the spec's §Detection already excludes the daemon port, the spec's route-validation line lists only the 1024 floor — this is an additive plan decision, recorded in "Under-specified points" #3).
6. **Prose instruction detection splices one custom mdast node whose text lives in `children`.** The node is `{ type: 'smartActionText', data: { hName: 'span', hProperties: { 'data-smart-action-instruction': token } }, children: [{ type: 'text', value: token }] }` — **no `value` field**. Evidence, `mdast-util-to-hast@13.2.1` `lib/state.js` `defaultUnknownHandler` (L407): a node with both `value` and `data.hProperties` takes the *element* branch and renders `state.all(node)` over a childless node, producing an empty `<span>` — with `children` and no `value` the same branch renders the text. The DOM prop key is the literal attribute: `hast-util-to-jsx-runtime@2.3.6` `lib/index.js:617-620` emits `info.attribute` when `info.space` is unset, and `property-information@7.1.0` `lib/find.js` builds `data-*` infos with no space — so the override reads `props['data-smart-action-instruction']`, not a camelCased key. The `span` override returns **bare `{children}`** (no element) when the chip does not apply, so negatives render identical `textContent` and identical rendered text.
7. **The remark plugin handles text nodes only.** It does not annotate `inlineCode` or `code` nodes. Both code seams already receive the raw string the annotation would have carried — the `Code` override gets it as `children`, `CodeHeader`/`SyntaxHighlighter` get it as the `code` prop — so `parseInstructionLine(<that string>)` at render time is exactly equivalent, and it is the only channel available anyway (decision 8). One responsibility, one `hProperties` mechanism, one access channel.
8. **Fence rendering: `CodeHeader` emits the chip; the body seams return `null`.** Verified in `@assistant-ui/react-markdown@0.14.6`:
   - `dist/primitives/MarkdownText.js` maps the user components map onto the block slots (`Pre: pre`, `Code: code`, `SyntaxHighlighter`, `CodeHeader`) and hands react-markdown `pre: PreOverride`, `code: CodeOverride`.
   - `dist/overrides/CodeBlock.js` renders `<CodeHeader/>` and `<{language ? SyntaxHighlighter : DefaultCodeBlockContent}/>` as **Fragment siblings** — neither can suppress the other, each can only return `null` for itself.
   - `dist/overrides/defaultComponents.js`: `DefaultCodeBlockContent` renders `<Pre><Code node children={code}/></Pre>` using the **user's** `Pre`/`Code`. So a language-less fence *does* flow through this repo's `Code` override (`markdown-text.tsx:45-73`, `useIsMarkdownCodeBlock()` true, `children` = the raw code string), and this repo's `pre` override is already a fragment passthrough (`markdown-text.tsx:250`) — no stray `<pre>` survives a suppressed body.
   - `dist/memoization.js` `memoizeMarkdownComponents` wraps **every** entry (including `SyntaxHighlighter` and `CodeHeader`) in a `WithoutNode` component, so no seam can read `node.properties`. Strings only — which is why decision 7 costs nothing.

   `CodeHeader` is the only seam invoked for both fence flavors, so it is the single emitting seam: it renders the block-variant chip when the shared hook matches, else today's header. `Code` (block branch) and `SyntaxHighlighter` return `null` on the same hook, killing the language-less and language-tagged bodies respectively. Three call sites, one hook, one decision.
9. **Find-bar text integrity:** search offsets are computed from live DOM `textContent` (`search-messages.ts:22`) and highlights are painted from the same DOM, so chip-added text cannot desynchronize offsets. `rangeFromOffsets` already walks multiple text nodes ("markdown splits text across nested nodes"), so splitting one text node into three siblings is safe. The instruction chip adds zero text (token is the only text; buttons are icon-only). The URL chip adds badge text (`tunnelled` etc.) and, for `[label](url)` links, swaps label→href — both accepted: badge text becomes findable, which is cosmetic. State this in the chip component doc comment.
10. **Spec testids are exact, and chips additionally carry a keyed attribute.** The spec fixes the ids (`smart-action-instruction-append`, `smart-action-instruction-new-session`, `smart-action-url-open`, `smart-action-url-stop-tunnel`) and they win; multiple chips in one paragraph repeat them, so tests disambiguate with `getAllByTestId(...)[n]` (`within()` does not help — the duplication is inside one container, and Playwright's `getByTestId` throws under strict mode). Each chip root also carries `data-smart-action-token={token}` / `data-smart-action-port={port}`, satisfying the repo's "keyed by domain id" rule without breaking the spec's contract. The pane rows, which the spec says are "keyed by port", use `remote-access-port-tunnel-stop-{port}`.
11. **Error toasts have one choke point, and it never downgrades a healthy tunnel.** `reportPortTunnelError(port, message)` in the store module sets state and raises `mfToast.error`, called from both the WS `error` event subscriber and the POST-rejection catch, with a per-port dedupe window (~1 s). A transport-level POST failure is independent of the tunnel's real state (the socket can drop over the very tunnel being used to reach a remote daemon), so **an entry already in `ready` is not overwritten** — log via tagged `console.warn` and drop. Otherwise a rejection landing after `ready` would flip a live chip to "tunnel failed".
12. **Stop on a mid-start tunnel is cancel-on-complete.** The pane lists `starting` entries with stop controls (AC #279.10), but a mid-start cloudflared is invisible to `TunnelManager::stop`. `PortTunnelRegistry::stop(port)` on a `Starting` entry marks it cancel-requested; when the in-flight `start` resolves `Ok`, the registry immediately stops the label and removes the entry.
13. **Scope ownership is keyed by `(project_id, chat_id)` and the path is resolved at teardown time — RULED by the user on 2026-07-25 ("Under-specified points" #1, option (a)).** Capturing `effective_path` at start leaks the tunnel whenever `disable_worktree` changes the chat's path under it, because scope release then calls `stop_scope_tunnels` with the new path and never matches the old key. Path resolution needs the db, which `mainframe-launch` must not gain, so the registry stores `{project_id, chat_id}` and exposes `entries_for_project`, while the matching loop lives in the server-crate seam impl that already has `AppCtx` (Task 8). The seam signature `stop_scope_tunnels(project_id, effective_path)` is unchanged, so the lifecycle tests and `FakeDeps` are unaffected by this choice.

---

## Task graph

```
T1 ─ T2 ─ T3 ─┬─ Rust track (sequential — cargo target lock): T5 → T6 → T7 → T8
              ├─ UI #278: T9 → T10 → T11 → T12 → T13
              └─ UI #279: T14 → T15 → T16 → T17
T18 (changeset), T19 (sweep) — after everything.
```

Cross-track edges (all from the collision map below, none optional):

- **T8 after T6** — both edit `crates/mainframe-daemon/src/main.rs`, and T8 consumes the registry binding T6 introduces.
- **T15 after T11** — both edit `markdown-text.tsx`; T15 needs T11's `LinkWithPreview` extraction.
- **T15 after T14** — the chip reads the store and `daemonPort`.
- **T17 after T14**, **T16 after T15**.

### File-collision map

| File | Tasks | Order |
|---|---|---|
| `packages/ui/package.json`, `packages/ui/CLAUDE.md` | T1 | T1 only — no other task installs or declares deps |
| `packages/types/src/index.ts` | T3 | T3 only |
| `crates/mainframe-daemon/src/main.rs` | T6, T8 | T6 → T8 |
| `crates/mainframe-server/tests/support/mod.rs` | T6, (T7 if a helper is missing) | T6 → T7 |
| `crates/mainframe-launch/src/lib.rs` | T5 | T5 only |
| `packages/ui/src/features/chat/parts/markdown-text.tsx` | T9 (provider wrap), T11 (overrides + extraction), T15 (`a` swap) | T9 → T11 → T15 |
| `packages/ui/src/features/chat/parts/CodeHeader.tsx`, `syntax-highlight.tsx` | T11 | T11 only |
| `packages/ui/src/app/App.tsx`, `store/` | T14 | T14 only |

Everything else is a new file owned by exactly one task.

---

### Task 1 — Environment setup and dependency declaration (core-dev, sequential first)

The worktree has no `node_modules` (root or packages) and no `packages/mobile` checkout. This is the **only** task that installs.

1. `git submodule update --init packages/mobile` (from the worktree root). If this fails (worktree/submodule interaction), **stop and report** — do not run a bare `pnpm install` without the submodule.
2. `packages/ui/package.json`: declare `unist-util-visit@^5.0.0`, `unist-util-visit-parents@^6.0.0`, `unified@^11.0.5`, `@types/mdast@^4.0.4` (versions matching the hoisted resolutions already in `pnpm-lock.yaml`: `unist-util-visit@5.1.0`, `unist-util-visit-parents@6.0.2`, `unified@11.0.5`, `@types/mdast@4.0.4`; `@types/mdast` goes in `devDependencies`). They are phantom deps today (`markdown-url-transform.ts:11-13` resolves via `shamefully-hoist`); Task 10 makes real use of them.
3. `packages/ui/CLAUDE.md:62-64`: delete the stale "**`zustand` is a phantom dep**" bullet — `zustand@^5.0.14` is already declared in `packages/ui/package.json` `dependencies`. Leaving a false known-gap entry behind while touching the same manifest violates the no-leftovers rule. If the "Known gaps / phantom deps" section is left empty by the removals in steps 2–3, drop the section heading too.
4. `pnpm install` from the worktree root.
5. Sanity: `git diff --stat pnpm-lock.yaml` must be a **small additive** diff (the four declarations). Any mass deletion → `git checkout -- pnpm-lock.yaml` and report.

**Files:** `packages/ui/package.json`, `packages/ui/CLAUDE.md`.
**Verify:** `pnpm --filter @qlan-ro/mainframe-types test` passes (existing suites); `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/parts/__tests__/markdown-text.test.tsx` passes; `pnpm --filter @qlan-ro/mainframe-ui typecheck` passes.

### Task 2 — types: smart-actions unit tests, red (test-writer)

Two test files, mirroring the two source modules Task 3 creates, co-located per the `automation-domain/__tests__` precedent. Behavior-based, hardcoded expectations — no reimplementing the grammar in the test.

**`packages/types/src/smart-actions/__tests__/instructions.test.ts`** (AC #278.6):
- `findSlashInstructions(text)` (prose scan): `/domain-modeling` at start / after whitespace; namespaced `/codex:review`; sentence-final `run /domain-modeling.` captures the token without the period; returns `{start, end, token, name}` with offsets that slice back to the token.
- Negatives: `/usr/bin/env` (followed by `/`), `/README.md` (`.` + word char), mid-word `a/b`, `//`, empty name, second `:` segment, **and a name with a character outside `[a-zA-Z0-9_-]`** (e.g. `/domain modeling`, `/foo$bar` → matches `foo` only or nothing per the charset rule — assert the exact expectation).
- `parseInstructionLine(text)` (whole-content for spans/fences): `/todo-pipeline run` → `{insertText: '/todo-pipeline run', name: 'todo-pipeline'}`; leading/trailing whitespace tolerated (`insertText` is the trimmed line); multi-line → null; content with a prefix (`run /x`) → null; a name with a disallowed character → null.

**`packages/types/src/smart-actions/__tests__/port-tunnels.test.ts`** (AC #279.9):
- `classifyLocalhostUrl(href)`: `localhost` / `127.0.0.1` / `[::1]`, http+https, explicit ports, default 80/443 by scheme; non-matches: public hosts, `https://example.com/localhost`, `file:`/`ws:` schemes, unparsable hrefs.
- `isTunnelEligiblePort(port, daemonPort)`: 1024–65535 in, `<1024` out, daemon port out.
- `portTunnelLabel(5173)` → `'port:5173'`; `parsePortTunnelLabel('port:5173')` → `5173`; `parsePortTunnelLabel('daemon' | 'preview:x' | 'port:abc')` → `null`.

**Files:** both test files (new).
**Verify:** `pnpm --filter @qlan-ro/mainframe-types exec vitest run src/smart-actions/__tests__/` fails only because the modules do not exist (red).

### Task 3 — types: smart-actions modules, green (core-dev)

A directory, not one file — the split is structural so the #278 and #279 commits are whole-file adds with no hunk surgery. Pure, React-free, I/O-free (the `automation-domain/index.ts` convention). ESM imports use `.js` extensions.

**`packages/types/src/smart-actions/instructions.ts`** (#278 commit):
- `findSlashInstructions(text): InstructionMatch[]` with `{start, end, token, name}`. Grammar (spec §Instruction grammar, verbatim): `/` + a name matching **`[a-zA-Z0-9_-]+`**, optionally one `:` segment (`/codex:review`); boundary = start-of-text or preceding whitespace; not followed by `/`; not followed by `.` + a word character. `token` = `/name` or `/ns:name`.
- `parseInstructionLine(text): {insertText, name} | null` — the entire trimmed content is one instruction plus optional arguments. **`insertText` is the whole trimmed line including arguments**; it is deliberately *not* named `token`, because `findSlashInstructions`'s `token` is the bare `/name` and one name for two semantics in one module invites the wrong one being inserted. Doc-comment both.
- The spec's `parseSlashInstruction` names this pair — keep both exported and doc-comment the mapping.

**`packages/types/src/smart-actions/port-tunnels.ts`** (#279 commit):
- `classifyLocalhostUrl(href): {port: number} | null` (hosts `localhost`/`127.0.0.1`/`[::1]`, schemes http/https, effective port explicit-else-80/443). Classification only — eligibility is separate: `isTunnelEligiblePort(port, daemonPort): boolean` (1024–65535 and `port !== daemonPort`).
- Labels: `PORT_TUNNEL_LABEL_PREFIX = 'port:'`, `portTunnelLabel(port)`, `parsePortTunnelLabel(label): number | null`.
- Wire contract (single canonical types): `PortTunnelStartRequest {port, chatId}`, `PortTunnelStartResponse {url, port}`, `PortTunnelInfo {port, url?, state: 'starting' | 'ready'}`, `PortTunnelsList {tunnels: PortTunnelInfo[]; daemonPort: number}` (decision 5).

**`packages/types/src/smart-actions/index.ts`** — barrel re-exporting both (#278 commit; the #279 commit appends its line). Add `export * from './smart-actions/index.js';` to `packages/types/src/index.ts`.

**Files:** the three module files (new), `packages/types/src/index.ts`.
**Verify:** Task 2 files green; `pnpm --filter @qlan-ro/mainframe-types test` (whole package); `pnpm --filter @qlan-ro/mainframe-types build`.

### Task 5 — Rust: `PortTunnelRegistry` (core-dev; TDD in-crate)

*(No Task 4 — the test-helper extraction folded in here.)*

1. Extract the stub-cloudflared script writers from `tunnel_manager.rs`'s private `mod tests` (`write_fake_cloudflared` L974, `write_silent_cloudflared` L1125, `recorder()` L695) into a shared `#[cfg(test)] pub(crate) mod test_support` in `crates/mainframe-launch/src/` so the registry tests reuse them. Pure refactor; existing `cargo test -p mainframe-launch` stays green.
2. TDD `crates/mainframe-launch/src/port_tunnel_registry.rs` (new):

```rust
pub struct PortTunnelScope { pub project_id: String, pub chat_id: String }   // decision 13
pub struct PortTunnelRegistry { manager: Arc<TunnelManager>, inner: Mutex<HashMap<u16, Entry>> }
// Entry: Starting { scope, waiters (watch/Shared), cancel_requested: bool } | Ready { scope, url }
impl PortTunnelRegistry {
    pub fn new(manager: Arc<TunnelManager>) -> Self;
    pub async fn start(&self, port: u16, scope: PortTunnelScope) -> Result<String, String>;
    pub fn stop(&self, port: u16);                     // idempotent; unknown port no-op
    pub fn entries_for_project(&self, project_id: &str) -> Vec<(u16, String)>;  // (port, chat_id)
    pub fn list(&self) -> Vec<PortTunnelEntryInfo>;    // {port, url: Option<String>, ready: bool}
}
```

Contract (spec §Daemon contract + Decisions 10/11/20, plan decisions 2/3/12/13):
- **Invariant (decision 2): the registry never spawns a process.** Every spawn is `TunnelManager::start`, which owns `spawn_output_drain`. Do not "optimize" a direct spawn in here — a cloudflared child without a lifelong drain SIGPIPE-dies after ready.
- `start`: under the lock — `Ready` entry → **liveness-check first**: if `manager.get_url(label)` is `None` the exit watcher already reaped that cloudflared (`tunnel_manager.rs:469-497` removes the label and broadcasts `Stopped` behind the registry's back), so drop the entry and fall through to a fresh start; otherwise update `scope` (last-start-wins) and return the existing url **without** calling `TunnelManager::start` (which would kill-and-respawn, minting a new URL). `Starting` entry → subscribe to its waiters and await the shared result. Else insert `Starting`, release the lock, call `manager.start(port, &portTunnelLabel, None)`, then on `Ok` transition to `Ready` (unless cancel_requested → `manager.stop(label)` + remove) and on `Err` remove the entry; either way notify waiters. Exactly one `TunnelManager::start` per port at a time.
- `stop`: `Ready` → `manager.stop(label)` + remove; `Starting` → set `cancel_requested` (decision 12); absent → no-op.
- `entries_for_project`: every entry (both states) whose scope's `project_id` matches, with its originating `chat_id`. Path resolution is the caller's job (decision 13).
- `list`: `Starting` → `{port, url: None, ready: false}`; `Ready` → same liveness check as `start` — drop and skip the entry when `manager.get_url(label)` is `None`.
- Label: `format!("port:{port}")` behind a `pub const PORT_TUNNEL_LABEL_PREFIX: &str = "port:"` + helper — one definition, kept in sync with the TS constant by a doc comment cross-reference.

Export from `crates/mainframe-launch/src/lib.rs`.

In-crate tests (write first), using the extracted stubs + tiny `TunnelConfig` timings:
- concurrent `start` × 2 for one port spawns exactly one cloudflared (count via a stub script that appends to a file in the tempdir) and both callers get the same URL;
- `start` on a ready port returns the existing URL, no respawn;
- **ready entry whose manager label is gone → `start` restarts and returns a new URL** (kill the stub child / `manager.stop(label)` behind the registry's back, then `start`);
- `list` prunes an entry whose manager label is gone;
- `stop` idempotent + unknown no-op;
- cancel-on-complete (stop during `Starting` with the silent stub → after resolve, label absent from manager);
- `entries_for_project` returns only matching-project entries with their chat ids;
- last-start-wins scope update.

**Files:** `crates/mainframe-launch/src/port_tunnel_registry.rs` (new), `crates/mainframe-launch/src/tunnel_manager.rs` (test extraction only), `crates/mainframe-launch/src/test_support.rs` (new, cfg(test)), `crates/mainframe-launch/src/lib.rs`.
**Verify:** `cargo test -p mainframe-launch` green; `cargo fmt`; new file ≤300 lines (registry logic only — no route/JSON concerns).

### Task 6 — Rust: registry construction, AppCtx, routes, test-harness injection (core-dev)

1. **Construct once, share twice.** In `crates/mainframe-daemon/src/main.rs`, bind the registry immediately after the `tunnel_manager` binding (`main.rs:176-187`):
   `let port_tunnels = Arc::new(PortTunnelRegistry::new(Arc::clone(&tunnel_manager)));`
   This placement is load-bearing: the chat deps / `RegistryLaunchStopper` build sits at `main.rs:268-278`, ~80 lines **before** the `AppCtx` construction at `main.rs:345-361`, and Task 8 wires its stopper at that earlier site. Constructing at `AppCtx` would put the binding out of scope for its first consumer. Pass `Arc::clone(&port_tunnels)` into `AppCtx` here; Task 8 adds the second clone at the chat-deps site.
2. **AppCtx:** add `pub port_tunnels: Option<Arc<PortTunnelRegistry>>` to `crates/mainframe-server/src/ctx.rs` (next to `tunnel_manager` at L125); update `test_ctx()` (ctx.rs:241) and the `main.rs` construction — `Some(port_tunnels)` whenever `tunnel_manager` is `Some`.
3. **Routes:** new `crates/mainframe-server/src/routes/tunnel_ports.rs` (existing `tunnel.rs` is 207 lines — do not grow it). House pattern throughout: `parse_body` (from `routes/projects.rs:27`), `ok`/`ok_empty`/`fail` from `respond.rs`, `body: Bytes` last-arg extractor, serde structs matching the Task 3 TS contract (`#[serde(rename_all = "camelCase")]`).
   - `POST /api/tunnel/ports/start` `{port: u16, chatId: String}` → gate `let (Some(reg), true) = (ctx.port_tunnels.as_ref(), ctx.port != 0) else fail(400, "Tunnel not available")` (the `tunnel.rs:48` shape); validate `port >= 1024` (u16 caps 65535; serde rejects >65535 → explicit check for 0..1023, `fail(400, ...)`) and `port != ctx.port` (decision 5); resolve chat → `ctx.db` chat lookup for `project_id` (unknown chat → `fail(400, ...)`), then build `PortTunnelScope { project_id, chat_id }`; `reg.start(port, scope).await` → `ok(json!({"url": url, "port": port}))` or `fail(500, message)`.
   - `POST /api/tunnel/ports/stop` `{port: u16}` → gate on `port_tunnels` only; `reg.stop(port)`; `ok_empty()` (idempotent).
   - `GET /api/tunnel/ports` → gate; `ok(json!({"tunnels": [...], "daemonPort": ctx.port}))` with `state: "starting" | "ready"` per `PortTunnelInfo`. `daemonPort` is decision 5 — it is what makes the client's eligibility check agree with this route's rejection on a remote daemon.
   - `pub fn router()` with flat absolute paths; register `pub mod tunnel_ports;` in `routes/mod.rs` (near L38) and `.merge(routes::tunnel_ports::router())` in `http.rs` (~L67). Auth comes free from the existing layer.
4. **Harness:** in `crates/mainframe-server/tests/support/mod.rs`, add `pub async fn spawn_test_server_with(opts: TestServerOptions) -> TestServer` (existing `spawn_test_server(auth)` becomes a thin wrapper) where `TestServerOptions { auth_secret: Option<String>, tunnel: bool, port: u16 }`; when `tunnel` is set, write a stub cloudflared `#!/bin/sh` script into the harness `TempDir` (replicating `write_fake_cloudflared` — it is `cfg(test)`-private to `mainframe-launch` and not reachable here; also add a spawn-counting variant that appends a line to `$TMPDIR/spawns.log`), build `TunnelManager::with_config(Some(broadcast_fn), TunnelConfig { cloudflared_bin, dns_poll: 20ms, dns_timeout: 100ms, start_timeout: 3s, ..Default::default() })`, wrap in `PortTunnelRegistry`, and set a non-zero `ctx.port` (the `ctx.port != 0` gate; route tests assert `daemonPort` equals it). `AppCtx` is behind an `Arc` with no interior mutability for these fields — they must be set at construction, which is why this is an options variant, not post-hoc mutation.

**Files:** `crates/mainframe-server/src/ctx.rs`, `crates/mainframe-server/src/routes/tunnel_ports.rs` (new), `crates/mainframe-server/src/routes/mod.rs`, `crates/mainframe-server/src/http.rs`, `crates/mainframe-server/tests/support/mod.rs`, `crates/mainframe-daemon/src/main.rs`.
**Verify:** `cargo check` (workspace); `cargo test -p mainframe-server` (existing suites green — proves the harness refactor is compatible); `cargo fmt`.

### Task 7 — Rust: route integration tests (test-writer)

`crates/mainframe-server/tests/routes_tunnel_ports.rs` (new), convention per `routes_tags.rs`: header doc comment, `mod support;`, `fn client()`, `#[tokio::test]` per case. Uses `spawn_test_server_with` from Task 6. Coverage = AC #279.7 verbatim:

- Happy path: create project + chat (support helpers), start → `{success: true, data: {url, port}}` with a `trycloudflare`-shaped stub URL; `GET` lists it `ready`; stop → `{success: true}`; `GET` empty.
- `GET` returns `daemonPort` equal to the harness's `ctx.port` (decision 5 — the client's eligibility check depends on this field existing).
- Second start for the same port returns the **same** URL (no respawn — assert `spawns.log` has one line).
- **Two concurrent starts** (`tokio::join!` on two POSTs) → one line in `spawns.log`, both responses carry the same URL.
- Mid-start visibility: with the silent stub, fire start (don't await), `GET` shows `{port, state: "starting"}` with no `url`.
- Validation: port 0 / 1023 / 70000 (serde u16 reject) / `port == ctx.port` → 400; unknown `chatId` → 400; malformed body → 400 "Invalid request body".
- No manager: plain `spawn_test_server(None)` → all three routes `fail(400, "Tunnel not available")`.
- Stop unknown port → `ok_empty` (idempotent).
- Envelope shapes asserted exactly (`success`/`data`/`error` keys).

**Files:** `crates/mainframe-server/tests/routes_tunnel_ports.rs` (new); `tests/support/mod.rs` only if a helper is missing.
**Verify:** `cargo test -p mainframe-server --test routes_tunnel_ports`; `cargo fmt`.

### Task 8 — Rust: scope-release teardown seam (core-dev; TDD — the launchless test first) — after Task 6

Per plan decisions 1 and 13. Write the failing test first: in `crates/mainframe-chat/src/lifecycle_manager.rs` `mod tests`, extend `FakeDeps` (stop stub at L1084) with `stop_scope_tunnels` recording into `tunnel_stop_calls: Mutex<Vec<(String, String)>>`, and add **`launchless_scope_release_still_stops_port_tunnels`**: a scope that never ran a launch config (deps' `stop_launch_processes` returns `None` — exactly the `LaunchRegistry::get → None` shape) archives its last chat → `tunnel_stop_calls` records the scope, and `LaunchScopeReleased` is still emitted. Extend the three existing tests (L1160–1220) to assert the tunnel-stop call (or its absence for `shared_scope_keeps_the_scope_alive`).

Then implement:
1. Lifecycle deps trait (`lifecycle_manager.rs:106` area): add `fn stop_scope_tunnels<'a>(&'a self, project_id: &'a str, effective_path: &'a str) -> Option<BoxFuture<'a, ()>>` — same shape as `stop_launch_processes`. This signature is deliberately path-based even though the registry keys by chat (decision 13): the fake-deps tests and the call site are unaffected by the chat-keyed scope.
2. Call site (`lifecycle_manager.rs:594-601`): inside the `last_user` branch, await `stop_scope_tunnels` as a sibling of `stop_launch_processes`, before the unconditional `emit_event(LaunchScopeReleased ...)`. This is the load-bearing point: teardown must NOT live inside `stop_launch_processes`/`LaunchRegistry`, which no-op for launchless scopes.
3. Forwarding impls: `chat_manager.rs` trait decl + its two forwarding impls (~L199/542/717); `config_manager.rs` deps trait if it shares the same trait (impl forwards; the config-change path at L520 does **not** call it — decision 1).
4. Seam: in `crates/mainframe-server/src/chat_seams.rs`, `pub trait ScopeTunnelStopper` + `NoopScopeTunnelStopper` + `RegistryScopeTunnelStopper`, mirroring `LaunchStopper` (L26-87). The registry impl holds `Arc<PortTunnelRegistry>` **and** the path resolver it needs (an `Arc<AppCtx>`-shaped handle or a boxed async `Fn(&str, &str) -> Option<String>` wrapping `ctx.effective_path`), and implements the match:

   ```
   for (port, chat_id) in registry.entries_for_project(project_id) {
       match resolve_effective_path(project_id, &chat_id).await {
           Some(p) if p == effective_path => registry.stop(port),  // same scope, path resolved NOW
           None => registry.stop(port),                            // owning chat is gone → stop
           _ => {}                                                 // different live scope → keep
       }
   }
   ```

   Resolving at teardown (rather than comparing a path captured at start) is what closes the `disable_worktree` leak. Path resolution stays in the server crate; `mainframe-launch` gains no db dependency.
5. Production impl in `chat_deps.rs` (~L479-486, next to the launch seam); wire `RegistryScopeTunnelStopper` in `main.rs` at the chat-deps build (`main.rs:268-278`) from the `port_tunnels` binding Task 6 introduced at `main.rs:176-187`.
6. Update the other fake deps impls: `chat_manager/tests.rs:212`, `config_manager.rs:588`.

**Files:** `crates/mainframe-chat/src/lifecycle_manager.rs`, `crates/mainframe-chat/src/chat_manager.rs`, `crates/mainframe-chat/src/chat_manager/tests.rs`, `crates/mainframe-chat/src/config_manager.rs`, `crates/mainframe-server/src/chat_seams.rs`, `crates/mainframe-server/src/chat_deps.rs`, `crates/mainframe-daemon/src/main.rs`.
**Verify:** `cargo test -p mainframe-chat` (new + extended tests green); `cargo test -p mainframe-server` (compile + seams); `cargo fmt`. AC #279.8 satisfied.

### Task 9 — UI: render gate context (ui-dev)

1. `packages/ui/src/features/chat/smart-actions/smart-actions-context.tsx` (new): copy the `composer-edit-context.tsx` shape (37 lines) — `createContext(false)`, `SmartActionsProvider`, `useSmartActionsEnabled()` defaulting to `false`. This is the "rendered by `MarkdownText`" gate (spec Decision 6): the three other `markdownComponents` consumers (`UserMessage.tsx:57`, `ReviewCommentCard.tsx:21`, `PlanBubble.tsx:20`) never mount the provider and need no changes.
2. Wrap the primitive in `MarkdownTextImpl` (`markdown-text.tsx:269-283`) with `<SmartActionsProvider>`.

Dependencies are already declared and installed (Task 1) — **do not run `pnpm install`**.

**Files:** `packages/ui/src/features/chat/smart-actions/smart-actions-context.tsx` (new), `packages/ui/src/features/chat/parts/markdown-text.tsx` (wrap only).
**Verify:** `pnpm --filter @qlan-ro/mainframe-ui typecheck`; `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/parts/__tests__/markdown-text.test.tsx` (unchanged behavior).

### Task 10 — UI: `remarkSmartActions` plugin, TDD (ui-dev)

`packages/ui/src/features/chat/smart-actions/remark-smart-actions.ts` (new). Mirrors the `remarkAppLinks` precedent (`markdown-url-transform.ts:41-72`) but with real ancestor checks via `unist-util-visit-parents` (the precedent's one-level `parent.type === 'link'` check is too shallow for e.g. emphasis-inside-link).

**One responsibility: split `text` nodes** (plan decision 7 — no `inlineCode`, no `code`; both code seams already hold the raw string at render time, and `node` is stripped from every memoized component so an annotation could not be read there anyway).

- Skip any text node with a `link` ancestor. For each `findSlashInstructions` match, splice `[before?, tokenNode, after?]` where

  ```ts
  tokenNode = {
    type: 'smartActionText',
    data: { hName: 'span', hProperties: { 'data-smart-action-instruction': token } },
    children: [{ type: 'text', value: token }],   // NOT `value: token` — see plan decision 6
  }
  ```

  The `value`-vs-`children` distinction is the whole mechanism: `mdast-util-to-hast`'s `defaultUnknownHandler` renders `state.all(node)` for any node carrying `hProperties`, so a node with `value` and no `children` emits an **empty** `<span>` and the token text disappears from the transcript — which is the common (unresolved-name) case.
- Register the custom node type by module augmentation so no cast and no `@ts-ignore` is needed:
  `declare module 'mdast' { interface PhrasingContentMap { smartActionText: SmartActionText } }` (plus `RootContentMap`), with `SmartActionText extends Parent` in the plugin file.
- Module-level constant, idempotent per parse, no catalog access (gating is render-time by construction).

Unit tests first — `packages/ui/src/features/chat/smart-actions/__tests__/remark-smart-actions.test.ts` (node project): run `unified().use(remarkParse).use(remarkGfm).use(remarkSmartActions)` over fixtures and assert the mdast shape (splices, link-skip, path/file negatives untouched, `inlineCode`/`code` nodes untouched). Include one jsdom-pragma rendering case (react-markdown + the plugin) asserting the DOM is exactly `<span data-smart-action-instruction="/domain-modeling">/domain-modeling</span>` — **assert the text content, not just the attribute**; an empty span is the failure mode this test exists to catch. If it does come back empty, the node still carries `value` — move the text into `children`. Assert the prop key reaches a component override as the literal `'data-smart-action-instruction'` (verified in `hast-util-to-jsx-runtime@2.3.6` `lib/index.js:617-620` + `property-information@7.1.0` `lib/find.js`; the test pins it against dependency drift).

**Files:** plugin + test file (both new).
**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/smart-actions/__tests__/remark-smart-actions.test.ts`.

### Task 11 — UI: InstructionChip + override integration (ui-dev)

1. **Extraction first (required, not conditional):** move `LinkWithPreview` + `useCopyHref` (`markdown-text.tsx:80-202`) to `packages/ui/src/features/chat/parts/link-with-preview.tsx` as a pure move, keeping `markdownComponents.a` pointing at the import (existing tests read `markdownComponents.a` and stay green). Task 15 depends on this, and `markdown-text.tsx` is at 286 of its 300-line budget before this task adds anything.
2. **Chip component** `packages/ui/src/features/chat/smart-actions/InstructionChip.tsx` (new): verbatim spec classes — chip `inline-flex items-center gap-1 rounded-md border border-border bg-muted/60 pl-1.5 pr-1 py-0.5 align-baseline`; `<code class="font-mono text-caption">{token}</code>`; two icon buttons (`rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground`, lucide `size-3.5`): `CornerDownLeft` "Add to composer" `data-testid="smart-action-instruction-append"`, then `MessageSquarePlus` "Run in a new session" `data-testid="smart-action-instruction-new-session"` — each with equal `title` and `aria-label`. Chip root also carries `data-smart-action-token={token}` (plan decision 10). Block variant: same chip inside `rounded-lg border border-border bg-muted/40 px-3 py-2`. Chips are light — no `React.lazy` (the lazy-load rule targets editors/visualizations).
3. **Gating hook** `use-instruction-chip.ts` (new) — the single decision point for all four seams: reads `useSmartActionsEnabled()` + `useChatSkills()`; a name chips only when `resolveSkillName`-style resolution finds it (exact `invocationName`/`name`, then `:{name}` suffix — reuse the exported `resolveSkillName` from `use-chat-skills.tsx:127` and check the result maps to a real skill, not the fallback-returns-input case); catalog loading or empty → no chip. Export two thin wrappers over one implementation: `useInstructionChipForToken(token)` (prose spans) and `useInstructionChipForLine(text)` (code seams, via `parseInstructionLine`).
4. **Override wiring** in `markdown-text.tsx` (small edits only — all logic imported from `smart-actions/`), per plan decisions 6 and 8:
   - **`span` entry** in `markdownComponents` (new): reads `props['data-smart-action-instruction']` (the literal key — `unstable_memoizeMarkdownComponents` strips `node`, so DOM props are the only channel) → chip when gated+resolved, else return bare `{children}` (no `<span>` element — identical rendered text for negatives). Nothing else in the chat pipeline emits `span` (no rehype-raw), so the override is otherwise passthrough.
   - **`Code` override, inline branch** (`markdown-text.tsx:45-73`): `useInstructionChipForLine(children)` matches → inline chip; else today's path untouched.
   - **`Code` override, block branch** (`useIsMarkdownCodeBlock()` true — this is the **language-less** fence body, reached via `DefaultCodeBlockContent`): hook matches → return `null`. The repo's `pre` override is already a fragment passthrough (`markdown-text.tsx:250`), so nothing empty survives.
   - **`SyntaxHighlighter`** (`syntax-highlight.tsx`, the **language-tagged** fence body): hook matches on the `code` prop → return `null`.
   - **`CodeHeader`** (`CodeHeader.tsx`): hook matches on the `code` prop → render the **block-variant chip** instead of the header. `CodeHeader` is the only slot invoked for both fence flavors, which is why it is the single emitting seam (plan decision 8); its Fragment sibling has already returned `null`, so AC #278.2's "chip, no header, no highlighter" holds for both flavors.
   - Add `remarkSmartActions` to `REMARK_PLUGINS` (`markdown-text.tsx:262`).
5. **Characterization test as verification of the decided design** (not as the decision procedure): `packages/ui/src/features/chat/smart-actions/__tests__/instruction-chip.test.tsx` mounts `MarkdownText`'s actual pipeline (MarkdownTextPrimitive + REMARK_PLUGINS + markdownComponents, inside `SmartActionsProvider` + a mocked `SkillsProvider` context) and pins, for **both** a language-less and a language-tagged single-line instruction fence: exactly one block chip, no `chat-code-copy` header button, no shiki output. If either flavor deviates, the seam map in plan decision 8 is wrong for the installed version — report with the observed render tree rather than patching a second emit site in.

**Files:** `InstructionChip.tsx`, `use-instruction-chip.ts`, `__tests__/instruction-chip.test.tsx` (new); `link-with-preview.tsx` (new, extraction); `markdown-text.tsx`; `syntax-highlight.tsx`; `CodeHeader.tsx`.
**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/smart-actions/__tests__/instruction-chip.test.tsx` and `.../parts/__tests__/markdown-text.test.tsx`; `pnpm --filter @qlan-ro/mainframe-ui typecheck`; `wc -l` on `markdown-text.tsx` ≤300.

### Task 12 — UI: instruction actions (ui-dev)

`packages/ui/src/features/chat/smart-actions/use-instruction-actions.ts` (new). Both actions insert `insertText` — the prose chip passes its `token`, the code seams pass `parseInstructionLine(...).insertText` (token + arguments). Never `token` from `parseInstructionLine`; that field does not exist (Task 3).

- **Append**: read live composer text via `composer.__internal_getRuntime?.().getState().text ?? composer.getState().text` (the `ComposerTriggers.tsx:166-177` pattern — `getState()` is tap-memoized/stale within a tick), then `setText(existing ? existing.trimEnd() + '\n' + insertText : insertText)`; focus the composer. Never sends.
- **New session** (the `SessionsNewButton.tsx` "pick" branch + issue #212 ordering, all awaits load-bearing):
  1. Source context from `useChatExtras()` (`use-chat-thread-runtime.ts:167`): `chatConfig.projectId`, `chatConfig.adapterId`. Chips only render on assistant messages in real chats, so `chatConfig` is non-null — still guard with a tagged `console.warn('[smart-actions] ...')` no-op (no silent catch).
  2. `resetNewThreadDraft(runtime.threads.getState().newThreadId)` → `await runtime.threads.switchToNewThread()` → read the new `newThreadId` → `await initializeDraft({ localId, projectId, port, defaultAdapterId, adapters, adapterId })` (all required args per `initialize-draft.ts:8-15`; `port` from `useDaemonPort()`, `defaultAdapterId` from `useSettingsStore`, `adapters` from `useAdapters()`, `adapterId` explicit from the source chat) → `aui.composer().setText(insertText)`. The `await` before `setText` is issue #212; the explicit `initializeDraft` prevents the picker / "Initializing session…" dead end (AC #278.4). Failures → `mfToast.error` (the `SessionsNewButton` convention).

**Files:** `use-instruction-actions.ts` (new); `InstructionChip.tsx` (wire buttons).
**Verify:** `pnpm --filter @qlan-ro/mainframe-ui typecheck`; behavior tests land in Task 13.

### Task 13 — UI: #278 test suite (test-writer)

Extend/author per AC #278.3–7, using the established mock patterns:

- `packages/ui/src/features/chat/smart-actions/__tests__/instruction-actions.test.ts` (jsdom pragma): mock `@assistant-ui/react` per `use-start-todo-session.test.ts` (spies for `setText`/`switchToNewThread`, plus `__internal_getRuntime` returning live text); mock `initialize-draft` + `reset-new-thread-draft` modules; assert append `"draft" → "draft\n/domain-modeling"` and the empty-composer case, the code-seam case inserting `insertText` with arguments (`/todo-pipeline run`), call ORDER (reset → switch → initialize → setText, switch awaited before setText), explicit `adapterId`/`projectId` passthrough, and that no send/append-message API is ever invoked.
- Extend `instruction-chip.test.tsx`: chip presence with a mocked catalog containing `domain-modeling`; absence for `/unknown-name`, `/usr/bin/env`, `/README.md`, a name with a disallowed character, multi-line fence, token inside a markdown link; sentence-final period case; single-line `/unknown-name` fence renders the native header + highlighting; catalog-loading renders no chip; buttons carry equal `title`/`aria-label` and the exact testids; **two chips in one paragraph** are addressed with `getAllByTestId(...)[n]` and are distinguishable by `data-smart-action-token`.
- **Streaming settle** (spec §Text integrity, otherwise untested): render `/domain-mod` (not in catalog) → no chip; rerender the same component with `/domain-modeling` → chip appears. Works by construction (remark re-parses per render) but AC-walkable only if asserted.
- **FindBar regression** (plan decision 9): a message whose text contains an unresolved token (span split into three text nodes) still yields correct match offsets/highlight through `search-messages.ts`.
- Negative surfaces: render `ReviewCommentCard` and `PlanBubble` fixtures containing a known token → no chip (no `SmartActionsProvider`); `UserMessage` markdown path likewise.

**Files:** `instruction-actions.test.ts` (new), `instruction-chip.test.tsx` (extended), plus the FindBar case in the existing search-messages test file; fixture-only additions elsewhere.
**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run <each file>` individually (React.act rule).

### Task 14 — UI: port-tunnel store, seed, subscriber, API client (ui-dev) — parallel-safe with T5–T13

1. **API client** `packages/ui/src/lib/api/tunnel-ports.ts` (new), pattern-matching `lib/api/tags.ts` + the defensive parsing of `lib/api/remote-access.ts`: `startPortTunnel(port, body: PortTunnelStartRequest)`, `stopPortTunnel(port, portNum)`, `listPortTunnels(port): Promise<PortTunnelsList>` via `request<T>`/`requestEmpty` from `lib/api/http.ts`. Types from `@qlan-ro/mainframe-types`.
2. **Store** `packages/ui/src/store/port-tunnels.ts` (new), structural copy of `store/quota.ts` (no actions in the store; free functions + selector hooks):
   - `byPort: Record<number, { state: 'starting' | 'ready' | 'error'; url?: string; error?: string }>` (absent = no tunnel), plus `daemonPort: number | null` from the seed (plan decision 5).
   - `usePortTunnel(port)`, `usePortTunnelList()`, `useTunnelDaemonPort()` selectors.
   - `applyPortTunnelEvent(e)`: filter `type === 'tunnel:status'` and `parsePortTunnelLabel(label) != null` (the daemon/`preview:` labels fall out; the existing pane hook's `label === 'daemon'` filter is untouched). Map: `starting`→starting; `ready`/`dns_verified`→ready+url; `error`→ via `reportPortTunnelError`; `stopped`→delete entry.
   - `reportPortTunnelError(port, message)` (plan decision 11): if the entry is already `ready`, log `console.warn('[port-tunnels] ...')` and **return without changing state or toasting**; otherwise set `error` state + one `mfToast.error`, per-port ~1 s dedupe.
   - `installPortTunnelSubscriber()` (daemonWs.onEvent, mounted once), `resetPortTunnels()` (clears `byPort` **and** `daemonPort`).
   - Seed `packages/ui/src/store/port-tunnels-seed.ts` (new, the `quota-seed.ts` shape with a generation counter so a stale snapshot can't clobber a newer WS transition — the `use-tunnel-status.ts:52` genRef precedent): `GET /api/tunnel/ports` → `starting`/`ready` entries + `daemonPort`; failures `console.warn('[port-tunnels] ...')`.
3. **Wiring — all three points, none optional:** register `resetPortTunnels()` in `packages/ui/src/features/daemon/reset-daemon-scoped-stores.ts` (L26-57); seed in **both** `App.tsx` effects — the `[activePort]` effect (~L57) **and** the `daemonWs.subscribeConnection` reconnect reseed (~L67, the path that gets missed); `installPortTunnelSubscriber()` in the mount-once effect (~L111).

**Files:** `lib/api/tunnel-ports.ts`, `store/port-tunnels.ts`, `store/port-tunnels-seed.ts` (all new); `reset-daemon-scoped-stores.ts`; `app/App.tsx`.
**Verify:** `pnpm --filter @qlan-ro/mainframe-ui typecheck`; store tests in Task 16.

### Task 15 — UI: UrlChip + link override branch (ui-dev) — after Tasks 11 and 14

1. **Link branch:** with `LinkWithPreview` extracted (Task 11), `markdownComponents.a` becomes a thin `SmartLink` in `packages/ui/src/features/chat/smart-actions/SmartLink.tsx`: `useSmartActionsEnabled()` && `classifyLocalhostUrl(href)` && `isTunnelEligiblePort(port, daemonPort)` → `<UrlChip …>`; every other case → `<LinkWithPreview …>` unchanged (privileged ports, daemon port, non-localhost, non-MarkdownText surfaces — AC #279.6). **`daemonPort` = `useTunnelDaemonPort() ?? useDaemonPort()`** (plan decision 5): the store value comes from the daemon's own `GET /api/tunnel/ports`; `useDaemonPort()` is only the pre-seed fallback, and on a remote daemon reached through a portless tunnel URL it is the *local* daemon's port, which would chip a link the route then rejects. The chip displays the **href** even for `[label](url)` links (acknowledged exception).
2. **`UrlChip.tsx`** (new; decompose state into `use-url-tunnel.ts` if the file nears 300 lines): spec-verbatim chip classes; URL in `font-mono text-caption text-primary` (real DOM text); badge `rounded px-1 text-caption` (`tunnelling…` `bg-muted text-muted-foreground`; `tunnelled` `bg-mf-success-tint text-mf-success`; `tunnel failed` `bg-mf-destructive-tint text-destructive`; hidden when local or no entry; no `/opacity` on `mf-*` tokens). Chip root carries `data-smart-action-port={port}` (plan decision 10).
   - **Local daemon** (`useDaemonIsLocal()` — `packages/ui/src/lib/daemon/use-daemon-is-local.ts`): `ExternalLink` / "Open" → `useHost().shell.openExternal(href)`; no badge, no stop, the word "tunnel" nowhere.
   - **Remote:** store entry absent → `Globe` / "Tunnel and open": on click set a component-local `pendingOpenRef`, disable the button, `startPortTunnel` POST with `{port, chatId}` (`chatId` from `useChatId()` — `packages/ui/src/features/chat/tools/chat-tool-context.ts:12`, the existing named hook) — the POST is a trigger; never gate UI on its resolution; a rejection → `reportPortTunnelError(port, message)` + revert. An effect watching `usePortTunnel(port)`: transition to `ready` with `pendingOpenRef` set → `openExternal(url)` **once**, `mfToast.success("Tunnel open — anyone with this link can reach port {port} on the daemon machine")`, clear the ref, re-enable as `Globe` / "Reopen tunnel URL" (opens the known url, no re-start). Entry `starting` (including from seed after reload) → badge `tunnelling…`, button disabled. `Unplug` / "Stop tunnel" `data-testid="smart-action-url-stop-tunnel"` renders only while an entry exists and the daemon is remote; click → `stopPortTunnel`; the `stopped` WS event clears the entry (no optimistic removal). `error` state → `tunnel failed` badge, button reverts and re-enables.
   - Open button `data-testid="smart-action-url-open"`; both buttons `title` == `aria-label`.
   - Shared-port coherence comes free from the store keying (every chip for a port renders the same entry).
   - Worst case, the POST stays pending ~90 s (`TunnelConfig::default()` = 45 s start + 45 s DNS) and `request<T>` (`packages/ui/src/lib/api/http.ts`) has no timeout. That is fine and deliberate: every transition rides WS events, and the stop control is live during `starting`. Do not add a timeout or a spinner tied to the promise.
3. **Optional shared chip shell**: if InstructionChip and UrlChip duplicate the container/button classes, extract `chip-shell.tsx` (the 3+-duplication rule is not yet hit at 2 — extract only if a third variant appears; keep the class strings verbatim either way).

**Files:** `SmartLink.tsx`, `UrlChip.tsx`, optionally `use-url-tunnel.ts` (new); `markdown-text.tsx` (a-override swap only).
**Verify:** `pnpm --filter @qlan-ro/mainframe-ui typecheck`; `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/parts/__tests__/markdown-text.test.tsx` (link suites still green — non-localhost unchanged).

### Task 16 — UI: #279 test suite (test-writer)

- `packages/ui/src/store/__tests__/port-tunnels.test.ts`: WS mapping table (starting/ready/dns_verified/error/stopped), label filtering (`daemon` and `preview:x` events ignored — the `use-tunnel-status.test.ts:114` rejection pattern), seed reconcile + generation guard (late snapshot cannot clobber a newer WS state), `daemonPort` stored from the seed and cleared by `resetPortTunnels`, error-toast choke point dedupe (mock `@/lib/toast`), and **`reportPortTunnelError` on a `ready` entry leaves the entry `ready` and raises no toast** (plan decision 11).
- `packages/ui/src/features/chat/smart-actions/__tests__/url-chip.test.tsx`: drive the store directly + a mocked `daemonWs` emit helper; local daemon → `ExternalLink`/"Open", direct `openExternal(href)`, no tunnel API call, no "tunnel" string anywhere in the chip; remote → start POST fired with `{port, chatId}`, disabled + `tunnelling…`, `ready` event → opens the event URL exactly once + exposure toast, `dns_verified` afterward changes nothing; a second chip for the same port shows identical state and does **not** open (pendingOpen is per-click); "Reopen tunnel URL" does not re-POST start; stop button lifecycle incl. never-on-local; failed start (POST rejection AND error event) → badge + revert + single toast; UI never gates on the POST resolving (assert transitions occur while the start promise is still pending).
- **Eligibility against the daemon's port** (plan decision 5): with `daemonPort` seeded to a value different from `useDaemonPort()`'s, a link on the seeded daemon port renders `LinkWithPreview` (no chip) and a link on the local-fallback port renders a chip — the remote-daemon case AC #279.6 turns on.
- Reload seed: store seeded with a `starting` entry → chip shows `tunnelling…`, not a start button; seeded `ready` → `tunnelled`.

**Files:** the two test files (new).
**Verify:** each via `pnpm --filter @qlan-ro/mainframe-ui exec vitest run <file>`.

### Task 17 — UI: remote-access pane "Active port tunnels" (ui-dev) — after Task 14

`packages/ui/src/features/settings/panes/remote-access/ActivePortTunnelsSection.tsx` (new), slotted into `TunnelControl.tsx`'s section list (after `DevicesSection`). Follows the `DevicesSection.tsx:44-58` section conventions: `data-testid="settings-remote-access-port-tunnels-section"`, `text-label font-semibold text-muted-foreground` header. Sourced from `usePortTunnelList()` (store — already seeded + WS-fed; no new fetch path): one row per entry showing port, tunnel URL (or `starting`), and a stop control `data-testid="remote-access-port-tunnel-stop-{port}"` → `stopPortTunnel`. **Hidden entirely when the store has no entries.** Renders regardless of daemon locality (the pane is the global kill switch — spec Decision 18); the existing daemon-self section and `use-tunnel-status.ts` are untouched. Extend `TunnelControl.test.tsx` (or a new `ActivePortTunnelsSection.test.tsx`): hidden-when-empty, row + stop wiring, `starting` row rendering, daemon-self section unaffected by `port:` events.

**Files:** `ActivePortTunnelsSection.tsx` (+ test), `TunnelControl.tsx`.
**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/settings/panes/remote-access/__tests__/<file>` per file; typecheck.

### Task 18 — Changeset (core-dev)

Hand-write `.changeset/smart-action-chips.md` (the interactive `pnpm changeset` prompt is unusable here; match the existing file format in `.changeset/`): `@qlan-ro/mainframe-types` minor (new smart-actions module + wire contract), `@qlan-ro/mainframe-ui` minor (chips, store, pane section), `@qlan-ro/mainframe-app-tauri` minor (ships the daemon with the new `/api/tunnel/ports` routes). Summary: instruction chips + localhost tunnel chips, per the writing skill (concise, concrete).

**Files:** `.changeset/smart-action-chips.md` (new).
**Verify:** `git ls-files --others --exclude-standard .changeset/` shows the file; content names all three packages.

### Task 19 — Verification sweep (core-dev, last)

1. `pnpm --filter @qlan-ro/mainframe-types test` && `pnpm --filter @qlan-ro/mainframe-types build`.
2. `pnpm --filter @qlan-ro/mainframe-ui typecheck`.
3. Each new/extended UI test file individually via `vitest run` (list from Tasks 10, 11, 13, 16, 17) — plus `markdown-text.test.tsx` for regression.
4. From `packages/core-rs/`: `cargo fmt --check`; `cargo test -p mainframe-launch`; `cargo test -p mainframe-server`; `cargo test -p mainframe-chat`.
5. Limits: `wc -l` every new/heavily-edited file ≤300 (`markdown-text.tsx`, `tunnel_ports.rs`, `port_tunnel_registry.rs`, chips, store).
6. `git diff --stat pnpm-lock.yaml` — small, additive only (the four Task 1 declarations). `git ls-files` confirms no stray artifacts; confirm `@assistant-ui/*` pins unchanged in `packages/ui/package.json`.
7. Spec AC walk: check every #278 (1–7), #279 (1–10), and shared (1–4) criterion against a test or an implementation site; report any gap instead of hand-waving it.

---

## Under-specified points (surface to the user)

1. **Port tunnels leak when a chat's worktree config changes — NEEDS A USER RULING.** Recorded verbatim from the review:

   > `PortTunnelScope { project_id, effective_path }` (Task 5, L96) is captured at start. `disable_worktree` changes the chat's effective path. After that, `stop_scope(project_id, effective_path)` at scope release is called with the *new* path and never matches the entry keyed by the old one. The tunnel survives every teardown path except explicit stop and daemon shutdown — **a public URL to a local port, outliving the scope that created it**, with the pane as the only remedy.
   >
   > Options, cheapest first: (a) key the scope by `project_id` + originating `chat_id` and resolve the path at teardown time; (b) at scope release, also stop entries for the project whose `effective_path` no longer resolves to a live scope; (c) explicitly accept it and say so under "Under-specified points" so the user rules.

   **Recommendation:** (a) — it closes the leak at the source, costs one field plus a resolver in the seam impl, and needs no sweep or background reconciliation.
   **Status: RULED (2026-07-25, user).** Option (a): the scope is keyed by `chat_id`, with the path resolved at teardown. Decision 13 and Tasks 5/8 stand as written and are no longer revisable.
2. **Fence rendering seam is decided, not deferred** (plan decision 8) — `CodeHeader` emits, `Code`'s block branch and `SyntaxHighlighter` return `null`. Derived from the installed `@assistant-ui/react-markdown@0.14.6` sources; Task 11 step 5's test verifies it rather than deciding it. A version bump of that package should re-check `dist/overrides/CodeBlock.js`.
3. **The route rejects `port == ctx.port`, which the spec's route-validation line does not require** (it lists only the 1024 floor; the spec's §Detection does exclude the daemon port client-side). Kept as defence in depth, and `GET /api/tunnel/ports` now returns `daemonPort` so the client's gate and the server's rejection cannot disagree on a remote daemon. Dropping the server check instead would also be spec-conformant — it would leave a redundant second tunnel to the daemon's own port possible.
4. **Mid-start stop = cancel-on-complete** (plan decision 12) — the spec's idempotent-stop wording doesn't cover a `starting` entry, but the pane must be able to kill one.
5. **Duplicate in-chat testids across multiple chips in one message** (plan decision 10) — the spec's exact ids win; the added `data-smart-action-token` / `data-smart-action-port` attributes satisfy the repo's keyed-testid rule alongside them.
6. **`config_manager` worktree-config-change path does not stop port tunnels** (plan decision 1) — only the archive/scope-release seam does, per the spec's lifecycle list. This is the decision whose consequence is point 1 above.

## Review findings reversed

Two review points did not survive verification against the installed sources. Both are recorded so nobody re-derives them.

- **"`zustand` is still a phantom dep" (MINOR) — false.** `zustand@^5.0.14` is declared in `packages/ui/package.json` `dependencies` (line 70, immediately before the `devDependencies` block). The claim traces to `packages/ui/CLAUDE.md:62-64`, which still lists it under "Known gaps / phantom deps" — a stale doc entry. Task 1 step 3 deletes that bullet instead of adding a duplicate declaration.
- **"the `CodeHeader`/`SyntaxHighlighter` slots are invoked directly with `node`, so there the annotation is read as `node.properties[…]`" (M1, second access channel) — false**, and the "make the `Code` override the single emitting seam for both fence flavors" fix it motivated is not achievable. `markdown-text.tsx:206` passes the *entire* components map through `unstable_memoizeMarkdownComponents`, whose `WithoutNode` wrapper (`@assistant-ui/react-markdown@0.14.6` `dist/memoization.js`) strips `node` from **every** entry, `CodeHeader` and `SyntaxHighlighter` included — consistent with their current signatures (`CodeHeader.tsx:11`, `syntax-highlight.tsx:20`), which destructure only `{language, code}`. There is therefore one access channel, not two. Separately, `dist/overrides/CodeBlock.js` renders `SyntaxHighlighter` *instead of* `DefaultCodeBlockContent` when a language is present, and only `DefaultCodeBlockContent` routes through the user's `Code` override — so the `Code` override is never invoked for a language-tagged fence and cannot be the single emitting seam. `CodeHeader` is the only slot rendered for both flavors, which is why plan decision 8 puts the emit there. The review's underlying complaint — "the plan must name which sibling emits the chip and which return `null`" — is fully honored.

  The same investigation *confirmed* the half of M1 the review could not settle: `DefaultCodeBlockContent` (`dist/overrides/defaultComponents.js`) renders `<Pre><Code node children={code}/></Pre>` using the user's overrides, so a language-less fence body is suppressible from this repo's own `Code` override, and this repo's `pre` is already a fragment passthrough. No raw code content survives underneath the chip.

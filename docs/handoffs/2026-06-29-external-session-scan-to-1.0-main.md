# Handoff: port external-session scanning + title-gen fix to 1.0 `main`

**From:** `feat/app-tauri-wt` (pushed → `origin/feat/app-tauri-wt` @ `6160746c`)
**To:** the 1.0 `main` fork
**Scope (per request):** ONLY (1) the **scanning mechanism** (CLI `/resume`-parity discovery) and (2) the **title-generation change**. NOT pagination, NOT the API/route shape change, NOT the UI.
**Spec (full background):** `docs/specs/2026-06-29-external-sessions-progressive-listing-design.md` (on the branch — copy it to main for reference; ignore its pagination/UI sections, they're out of scope here).

---

## Why this is a *decoupled* port (read first)

On `feat/app-tauri-wt` the scanning rewrite and pagination were landed together: the rewritten `listExternalSessions` returns a paginated `ExternalSessionPage`, the adapter/service/route signatures changed, and the UI was rebuilt. **You don't want any of that on main.** You want the *better scan* (stat-only lite pass → head/tail enrichment → CLI-parity filters → drop the `sessions-index.json` path → title precedence) and the *title-gen ghost fix*, while keeping main's existing contract intact:

> `listExternalSessions(projectPath, excludeSessionIds): Promise<ExternalSession[]>` — **unchanged signature, unchanged return type.** Service/route/adapters/UI stay as they are on main.

This keeps main's `packages/desktop` UI (`ImportSessionsPopover.tsx`, `external-sessions-api.ts`) and the e2e working with zero changes.

**Verified divergence (origin/main vs the pre-feature base `5143f08b`):**
- `title-generator.ts`, `external-session-service.ts`, `claude/adapter.ts`, `codex/adapter.ts`, `server/routes/external-sessions.ts`, `claude/external-sessions.ts` → **identical** (`none`). Main's `external-sessions.ts` is the exact old code I replaced, so the transformation below applies verbatim.
- `packages/types/src/adapter.ts` → small diff (10+/4−); the one additive hunk we need (`title?`) may need hand-placement.

---

## Step 1 — Title generation (trivial, clean cherry-pick)

`title-generator.ts` is identical on main, so:

```bash
git cherry-pick cea5635e   # fix(core): prevent title-gen ghost sessions via --no-session-persistence
```

This adds `--no-session-persistence` to the `claude -p` title args (so title generation never writes a resumable session JSONL) and includes `title-generator-args.test.ts` (asserts the flag). Verify the `claude` binary you target supports the flag (`claude --help | grep no-session-persistence`). Done.

---

## Step 2 — Scanning mechanism

### 2a. Add the helper modules (clean adds — they don't exist on main)

```bash
git cherry-pick ade3a15d   # external-session-paths.ts (canonicalize+NFC, encodePath, discoverProjectDirs, cwdBelongsToProject, isUuidJsonl) + its test
git cherry-pick 7737ae5f   # external-session-enrich.ts (head/tail read, hide rules, title precedence) + its test + adds `title?` to types/adapter.ts
# OPTIONAL (only if you want the in-memory cache; harmless, but for a single non-paginated full scan it buys little):
git cherry-pick 82a9b7df   # external-session-cache.ts + its test
```

- `7737ae5f` touches `packages/types/src/adapter.ts` to add `title?: string` to `ExternalSession`. If it conflicts (main's adapter.ts differs by 10/4), resolve by hand-adding `title?: string;` to the `ExternalSession` interface — purely additive.
- `external-session-enrich.ts` imports `cwdBelongsToProject` from `external-session-paths.js` → pick `ade3a15d` before `7737ae5f`.
- If you SKIP the cache (2a optional), you must remove the cache calls in Step 2b (noted inline).

### 2b. Rewrite main's `external-sessions.ts` internals — NON-paginated

Do **not** cherry-pick `95dc7160` (it makes the function paginated). Instead, replace main's `external-sessions.ts` body with the lite-scan + enrich helpers but keep the `ExternalSession[]` return. The lite-scan and the bounded-concurrency enrich worker are exactly as on the branch; only the public `listExternalSessions` wrapper changes (no offset/limit/page).

Replace the entire file with:

```ts
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ExternalSession } from '@qlan-ro/mainframe-types';
import { createChildLogger } from '../../../logger.js';
import { canonicalizeProjectPath, discoverProjectDirs, isUuidJsonl } from './external-session-paths.js';
import { enrichSession, type Candidate } from './external-session-enrich.js';
import { getCached, setCached } from './external-session-cache.js'; // DROP this import if you skipped 2a-cache

const logger = createChildLogger('claude:external-sessions');

const ENRICH_CONCURRENCY = 8;
const TITLE_GEN_PREFIX = 'Generate a short title (2-5 words) for a coding chat that';

/** Stat-only candidate pass: UUID-named jsonl across all matching dirs, deduped + sorted mtime desc. */
async function scanLiteCandidates(projectPath: string, excludeSet: Set<string>): Promise<Candidate[]> {
  const canonical = await canonicalizeProjectPath(projectPath);
  const dirs = await discoverProjectDirs(canonical);
  const bySession = new Map<string, Candidate>();

  for (const dir of dirs) {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      /* expected: dir vanished between discovery and read */
      continue;
    }
    for (const name of names) {
      if (!isUuidJsonl(name)) continue;
      const sessionId = name.slice(0, -'.jsonl'.length);
      if (excludeSet.has(sessionId)) continue;
      const filePath = path.join(dir, name);
      let st: { mtimeMs: number; size: number };
      try {
        const s = await stat(filePath);
        st = { mtimeMs: s.mtimeMs, size: s.size };
      } catch {
        /* expected: file deleted mid-scan */
        continue;
      }
      const prev = bySession.get(sessionId);
      if (!prev || st.mtimeMs > prev.mtimeMs) {
        bySession.set(sessionId, { sessionId, filePath, mtimeMs: st.mtimeMs, size: st.size });
      }
    }
  }

  return [...bySession.values()].sort((a, b) => b.mtimeMs - a.mtimeMs || (a.sessionId < b.sessionId ? 1 : -1));
}

function isTitleGenGhost(s: ExternalSession): boolean {
  return !!s.firstPrompt && s.firstPrompt.startsWith(TITLE_GEN_PREFIX);
}

/** Enrich candidates with bounded concurrency, using the cache for unchanged files. */
async function enrichAll(candidates: Candidate[], projectPath: string): Promise<ExternalSession[]> {
  const out: (ExternalSession | null)[] = new Array(candidates.length).fill(null);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= candidates.length) return;
      const c = candidates[i]!;
      const cached = getCached(c.sessionId, c.mtimeMs, c.size); // DROP cache: const cached = null;
      if (cached) {
        out[i] = cached;
        continue;
      }
      const meta = await enrichSession(c, projectPath);
      if (meta) {
        setCached(c.sessionId, c.mtimeMs, c.size, meta); // DROP this line if no cache
        out[i] = meta;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(ENRICH_CONCURRENCY, candidates.length) }, worker));
  return out.filter((s): s is ExternalSession => s !== null && !isTitleGenGhost(s));
}

/** Non-paginated: full importable-session list for a project (preserves main's contract). */
export async function listExternalSessions(
  projectPath: string,
  excludeSessionIds: string[],
): Promise<ExternalSession[]> {
  try {
    const candidates = await scanLiteCandidates(projectPath, new Set(excludeSessionIds));
    return enrichAll(candidates, projectPath); // already mtime-desc ordered + filtered
  } catch (err) {
    logger.warn({ err: String(err), projectPath }, 'external-session scan failed');
    return [];
  }
}
```

That's the whole change: same public contract (`ExternalSession[]`), new internals. The adapter/service/route on main call this unchanged.

### 2c. Update the core test

Main has `packages/core/src/__tests__/claude-external-sessions.test.ts` (identical to my pre-feature version — tests the OLD index/readline behavior). Rewrite it for the new internals but for the **array** return (NOT pages). Start from the branch's rewritten test (commit `95dc7160`) and **drop the pagination cases** (`offset/limit`, `total`, `nextOffset`, `limit:0`); keep: enriched sessions newest-first, UUID-only filter (skips `progress.jsonl`), exclude-ids, empty-dir → `[]`. The fs mock (mock `node:fs/promises` `readdir`/`stat`/`open`; `open` handle serves bytes via `.read`/`.close`; module-level `stat` returns `{size, mtime, mtimeMs}`) is reusable as-is — see that commit's test for the scaffolding.

---

## What to SKIP (pagination/UI — out of scope)

Do **not** cherry-pick: `fd5d3887` (paginated signature), `c65e0ed8`/`cf4cdad5` (adapter pagination), `813fc93d` (service `scanPage`), `3919bf2e` (route Zod offset/limit), `a155ca83`/`6160746c` (pagination fixes), `d9bed49c`/`b36c6594`/`2a3adb37` (UI), `aabb6d07` (the branch's changeset). Keeping the contract means main's service `scan()`, the route, both adapters, and the desktop UI stay untouched.

> Note: the codex adapter on main also implements `listExternalSessions` returning `ExternalSession[]` — since you're NOT changing the interface signature, it stays as-is (no codex change needed). The cross-adapter merge fix (`6160746c`) was only relevant once the signature became paginated.

---

## Behavior you're importing (for the test + PR description)

- **Drops the `sessions-index.json` path** — always scans `*.jsonl` (the index is non-authoritative; written only by a `claude-mem` plugin, absent for most projects).
- **Stat-only lite pass**: `readdir` + `stat`, UUID-named files only (skips `progress.jsonl`/`queue-operation.jsonl` with no read), dedup by sessionId keeping newest mtime, sort mtime desc.
- **Head/tail enrichment** (64 KB each, string-scan robust to giant truncated first lines): hide `isSidechain` + `teamName` + wrong-cwd; title precedence `customTitle > aiTitle > summary > firstPrompt`; empty → `(session)`.
- **`--no-session-persistence`** on title-gen so it stops creating "Generate a short title…" ghost sessions; the scan also drops any pre-existing such ghosts as belt-and-suspenders.
- `title?` is now populated on `ExternalSession`. Main's `ImportSessionsPopover` currently renders `firstPrompt`; if you want CLI-parity titles shown, change it to prefer `session.title ?? session.firstPrompt` (optional, 1 line).

---

## Verify on main

```bash
cd packages/core && pnpm exec vitest run \
  src/plugins/builtin/claude/__tests__/external-session-paths.test.ts \
  src/plugins/builtin/claude/__tests__/external-session-enrich.test.ts \
  src/__tests__/claude-external-sessions.test.ts \
  src/__tests__/title-generator-args.test.ts
cd packages/core && npx tsc --noEmit -p tsconfig.json   # (main has a `typecheck`? check; this branch did not)
# e2e on main exercises this surface — sanity it:
pnpm --filter @qlan-ro/...-e2e exec playwright test 35-external-sessions   # adjust filter/name to main
```

Add a **changeset** (`@qlan-ro/mainframe-core` minor; `@qlan-ro/mainframe-types` patch for the additive `title?`). PR/commit per main's normal flow (NOT the shared app-tauri branch conventions).

---

## Gotchas carried from the branch build

- Shared worktrees on the app-tauri branch needed explicit-pathspec commits; on a clean main worktree that's not a concern, but still stage by name.
- `enrichSession` sources file size from a module-level `stat()` (the head/tail reader), then stats again for `modifiedAt` — two stats per file (minor; a known deferred cleanup).
- `external-session-enrich.ts` has one silent `catch` on the `modifiedAt` fallback that carries a `/* expected */` comment (added in `6160746c`); if you cherry-pick `7737ae5f` but not `6160746c`, add that comment by hand to satisfy the no-silent-catch lint rule.
- Deferred minors (non-blocking) recorded in `.superpowers/sdd/progress.md` under the "Progressive External-Session Listing" section.

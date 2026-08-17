# Todo #241 — Claude CLI Reverse-Engineering: Coverage Index and Findings

Research run 2026-07-25. Pinned CLI: **v2.1.220**
(`~/.local/bin/claude` → `~/.local/share/claude/versions/2.1.220`, Mach-O
arm64). Method: `claude-source-researcher` — read the leaked TypeScript source
(`~/Projects/qlan/claude-code/src/`, 2026-03-31 leak), reconcile against the
installed binary. Two reconciliation channels were used, and each doc states
which one carries a given claim:

1. **On-disk and runtime artifacts** — live transcripts, sidecar files, stream
   output.
2. **`strings` over the Mach-O.** The binary is Bun-compiled, so `strings`
   returns readable *minified JS*, including whole verbatim array and object
   literals. This is stronger than behavioral inference and it settled the
   hook-count question below. An earlier revision of this doc claimed the
   binary was opaque; that was wrong.

## Corrected premise

The todo brief assumed a doc set (PROTOCOL_REVERSED, COMPACTION, INTERRUPT,
CONTEXT_USAGE, MODELS, TODOS, PR_TRACKING, PREBUILT_PROMPTS_CATALOG) existed
and needed re-verification, and set the acceptance criterion "every
pre-existing doc carries a fresh version stamp". Neither half of that premise
survived contact. The eight named docs split two ways.

**Seven never existed.** COMPACTION, INTERRUPT, CONTEXT_USAGE, MODELS, TODOS,
PR_TRACKING and PREBUILT_PROMPTS_CATALOG have zero trace in any branch, any
reachable history, or GitHub. Nothing was lost and nothing was deleted — they
were never written. **The acceptance criterion is therefore vacuous for these
seven**: there is no stamp to refresh, and no amount of work in this run could
have produced one. They are gaps, not stale docs, and they are listed as such
in the coverage index below.

**One existed and had been lost.** `PROTOCOL_REVERSED.md`, along with
`CLAUDE-JSONL-SCHEMA.md` and `CLAUDE-JSONL-SAMPLES.md`, was written against CLI
**v2.1.37** and then dropped out of the tree in a **history rewrite** — not a
deletion commit. The last commit containing them, `75badd35`, is unreachable
from `main` (whose root is `4f97df78 Initial commit`), so `git log` on the
paths shows nothing and the files are invisible to every ordinary search. They
survive only as **unreachable objects in the local object store**, and were
recovered from there this run. All three were byte-identical to `75badd35`.

Two of the three are now restored under `docs/adapters/claude/`, each with a
banner stating its provenance and what supersedes it (see the coverage index).
`CLAUDE-JSONL-SAMPLES.md` was deliberately **not** restored: 197 KB of raw
transcript samples is fixture data, not documentation, and it remains
recoverable with `git show 75badd35:docs/adapters/claude/CLAUDE-JSONL-SAMPLES.md`
for as long as the object survives — re-extract it to a fixtures path if a test
ever needs it.

One further wrinkle on visibility: `docs/adapters/` is listed in
`.git/info/exclude`, so `git status` stays silent about every file in it.
Use `git ls-files` to check tracked state; a quiet `status` is not evidence
that a file is absent. `CONSUMED-SURFACE.md` is a separate case — it exists
only on the unmerged branch `todo/239-changelog-watch-skill` (PR #518, open).

## Coverage index

| CLI subsystem | Doc | Verified against | Status |
|---------------|-----|------------------|--------|
| Session transcript JSONL format + directory layout | [`docs/research/adapters/claude/SESSIONS_JSONL.md`](adapters/claude/SESSIONS_JSONL.md) | leak + 2.1.220 disk artifacts + binary strings | **New this run** |
| Hooks system (27 events in the leak, 31 in 2.1.220; 4 hook types, headless protocol) | [`docs/research/adapters/claude/HOOKS.md`](adapters/claude/HOOKS.md) | leak + 2.1.220 binary strings (verbatim `HOOK_EVENTS` array) | **New this run** |
| Permission-rule evaluation | [`docs/research/adapters/claude/PERMISSIONS.md`](adapters/claude/PERMISSIONS.md) | leak + 2.1.220 binary strings | **New this run** |
| Slash-command surface (taxonomy, full table, headless verdicts) | [`docs/research/adapters/claude/SLASH_COMMANDS.md`](adapters/claude/SLASH_COMMANDS.md) | leak + v2.1.211 binary strings (via CLEAR.md) | **New this run** |
| `/clear` deep-dive | [`docs/research/adapters/claude/CLEAR.md`](adapters/claude/CLEAR.md) | leak + v2.1.211 binary strings | Pre-existing (the only doc that was tracked and reachable). Not re-stamped to 2.1.220 — its binary claims are v2.1.211 string-verified; 2.1.220 ships the same command description but was not re-string-verified this run. Its "how Mainframe manages a session today" section was rewritten this run: it cited the TypeScript daemon in `packages/core`, which nothing has imported since the Rust cutover at `a8d1a561`, and now cites `packages/core-rs` |
| stream-json protocol core (`--sdk-url` WebSocket transport, control requests, event envelope) | [`docs/research/adapters/claude/PROTOCOL_REVERSED.md`](adapters/claude/PROTOCOL_REVERSED.md) | v2.1.37 only — **not** re-verified against 2.1.220 | **Restored this run** from unreachable git objects; carries a staleness banner naming the five areas the new docs supersede. Its `--sdk-url` transport coverage is unique — no other doc covers it |
| Transcript JSONL field inventory and observed frequencies (850+ files) | [`docs/research/adapters/claude/CLAUDE-JSONL-SCHEMA.md`](adapters/claude/CLAUDE-JSONL-SCHEMA.md) | v2.0.76–2.1.34 | **Restored this run**, subordinated to SESSIONS_JSONL.md by banner. Predates `permission-mode`, `relocated`/relocation, `last-prompt.leafUuid`, `toolUseId`/`spawnDepth`. Read it for field-frequency data, not for the entry union |
| Raw transcript samples | — (not restored) | v2.1.37 | Recovered but deliberately kept out of `docs/` — 197 KB of fixture data. Re-extract with `git show 75badd35:docs/adapters/claude/CLAUDE-JSONL-SAMPLES.md` if a test needs it |
| Consumed-surface inventory (what Mainframe touches) | `docs/research/adapters/claude/CONSUMED-SURFACE.md` | — | On branch `todo/239-changelog-watch-skill` (PR #518, open) only; deliberately not duplicated here. `CLAUDE-EVT-*`/`CLAUDE-FILE-*` ids were removed from this run's docs in favour of concrete `packages/core-rs` file:line cites, and should be reinstated alongside them once #518 merges |
| Rewind / checkpoint (file-history snapshots, restore flow) | — | — | **Undocumented.** Partial: `file-history-snapshot` entry shape in SESSIONS_JSONL.md; `/rewind` = interactive-only in SLASH_COMMANDS.md. No room this run for the restore mechanics |
| Skills / plugins loading | — | — | **Undocumented.** Partial: skills-as-prompt-commands + advertisement in SLASH_COMMANDS.md; plugin hook env vars in HOOKS.md. Loading/resolution order not covered this run |
| Compaction, interrupt, context usage, models, todos, PR tracking, prebuilt prompts | — | — | **Never documented.** These seven are the briefs' assumed docs that never existed (see Corrected premise) — gaps to write, not stamps to refresh. Institutional knowledge lives in memory notes and the Rust adapter source |

## Findings that touch Mainframe's adapter assumptions

Flagged only — no code changed (brief: docs only).

1. **Hook lifecycle events are already arriving and being dropped.** Mainframe
   passes `--output-format stream-json --verbose`, which makes the CLI emit
   `system/hook_started|hook_progress|hook_response` for SessionStart and
   Setup hooks unconditionally (`ALWAYS_EMITTED_HOOK_EVENTS`). The Rust
   adapter's system-subtype match (`events.rs:90-131` — `init`,
   `compact_boundary`, `task_started`, `task_updated`, `task_notification`,
   and a `status` subtype whose payload equals `"compacting"`) has no arm for
   them. They are not discarded *silently* in the logging sense —
   `handle_event` (`events.rs:~390`) emits a `tracing::debug!` for unmatched
   subtypes — but nothing reaches the UI, so a hook failure at session start
   is invisible to the user. `--include-hook-events` would surface all **31**
   events (2.1.220; 27 in the leak) if Mainframe ever wants them. (HOOKS.md)
2. **Hooks run without trust in SDK mode.** `shouldSkipHookDueToTrust()`
   short-circuits when non-interactive: Mainframe-spawned CLIs execute the
   user's configured hooks even in directories the interactive CLI would
   still be gating behind the trust dialog.
3. **HTTP hooks are skipped at SessionStart/Setup in *every* mode**, headless
   and interactive alike. `utils/hooks.ts:1851-1863` filters on
   `hookEvent === 'SessionStart' || hookEvent === 'Setup'` with **no
   interactivity guard**; the headless-deadlock concern appears in the
   comment as the *rationale* for the rule, not as a condition on it. So this
   is not a Mainframe-vs-terminal difference — the user's HTTP SessionStart
   hook does not fire in their terminal either. Triage should not go looking
   for a Mainframe-specific cause. (Corrected from an earlier revision of
   this doc, which scoped it to headless.)
4. **`system/init.slash_commands` is the authoritative headless capability
   list** (already filtered to what stream-json can run). Mainframe currently
   ignores this field; anything hardcoding command availability will drift
   (the leak→2.1.211 `/clear` flip proves commands get promoted post-release).
5. **`sessions-index.json` must never be relied on — it is a *removed legacy*
   artifact, not a new one.** An earlier revision of this doc read its absence
   from the leak as a post-leak addition; that is backwards. `sessions-index`
   appears 0× in the leaked source **and** 0× in the 2.1.220, 2.1.219 and
   2.1.218 binaries, and all 14 on-disk copies carry mtimes between
   2026-01-20 and 2026-02-17 — *predating* the 2026-03-31 leak snapshot.
   Nothing writes it anymore; the files on disk are fossils that will go
   staler every day. Mainframe's existing scan-`*.jsonl` decision is correct,
   and would have been correct for the opposite reason under the old reading.
   Method note: absence from the leak alone cannot date a file. Binary
   occurrence counts plus on-disk mtimes are what establish direction.
6. **Transcript entry union is open — and Mainframe already survives that.**
   2.1.220 writes entry types absent from the leaked union (`permission-mode`,
   `relocated`) and extra fields (`last-prompt.leafUuid`, `agent-*.meta.json`
   `toolUseId`/`spawnDepth`). This is context, not a defect report: the Rust
   transcript reader deserializes per-line and skips lines it cannot classify,
   so unknown types and fields are already tolerated. The actionable half is
   the opportunity — the meta.json `toolUseId` is a cleaner subagent↔parent
   join key than the current `toolUseResult.agentId` path, and it is on disk
   today.
7. **`promote_to_local_settings` inverts the CLI's destinations — an
   ephemeral "allow this one file write" is persisted to disk.**
   `mainframe-adapter-claude/src/session.rs:212-232` rewrites every
   `PermissionUpdate` carrying `destination: "session"` into
   `destination: "localSettings"`, behind a comment asserting that "the CLI's
   `permission_suggestions` always use `destination:"session"`". The premise
   is false: the CLI emits both destinations and uses the field to encode the
   user's *intent* — `session` is "for this session only", `localSettings` is
   "always allow", which is what the terminal CLI writes to
   `.claude/settings.local.json`. Collapsing the two means a user who grants a
   one-off permission in Mainframe silently gets a permanent rule committed to
   their project's settings file, with no UI ever having offered that choice
   and no affordance to undo it. The blast radius is every rule Mainframe has
   ever auto-promoted in an existing checkout. (PERMISSIONS.md)
8. **`control_cancel_request` is unhandled — cancelled permission prompts stay
   pending forever.** The CLI sends `control_cancel_request` to withdraw an
   in-flight `control_request` (typically a `can_use_tool` permission prompt)
   when the turn is interrupted or the tool call is abandoned. It occurs ×37
   in the 2.1.220 binary and **zero** times anywhere in `packages/core-rs`.
   `events.rs::handle_event` (~`:390-422`) has no arm for it, so Mainframe
   never learns the request is dead: the prompt stays in the UI, the user
   answers a question the CLI is no longer listening to, and the reply lands
   on nothing. (PERMISSIONS.md)

Findings 7 and 8 are documented as adapter mismatches only. **No adapter code
was changed** — implementation is out of scope for this brief, and both are
being filed as separate todos.

## Out of scope (per brief)

`/clear` and `/fork` deep-dives (todos #245/#246), the changelog-watch skill
(#239), and implementing any adapter change the findings above suggest.

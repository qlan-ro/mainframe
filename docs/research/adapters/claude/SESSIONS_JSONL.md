# Claude CLI — Session Transcript Storage (JSONL)

How the Claude CLI persists sessions on disk: directory layout, the JSONL entry
union, subagent sidechains, sidecar files, and what Mainframe's adapter can and
cannot rely on when reading these files.

Sources: TypeScript source (`claude-code/src/`, 2026-03-31 leak) —
`utils/sessionStorage.ts`, `utils/sessionStoragePortable.ts`, `types/logs.ts`,
`utils/toolResultStorage.ts`, `history.ts` — reconciled against installed
binary **v2.1.220** two ways: (a) on-disk artifacts, i.e. live transcripts
under `~/.claude/projects/`, and (b) `strings` over the Mach-O, which for this
Bun-compiled binary yields readable minified JS. Each drift row below states
which of the two established it. Drift is called out in
[Drift](#drift-leak--v21220).

## TL;DR

- One transcript per session: `~/.claude/projects/<sanitized-cwd>/<sessionId>.jsonl`,
  append-only JSONL. Each line is one `Entry` — either a conversation message
  or a metadata record (title, tag, PR link, mode, snapshots…).
- Subagent sidechains live **next to** the transcript in a per-session
  directory: `<projectDir>/<sessionId>/subagents/agent-<agentId>.jsonl` plus an
  `agent-<agentId>.meta.json` sidecar. Oversized tool results are offloaded to
  `<projectDir>/<sessionId>/tool-results/<toolUseId>.{txt,json}`.
- `~/.claude/history.jsonl` is a **different file** — global prompt history for
  the up-arrow, not the transcript. Do not confuse the two.
- The file materializes lazily: nothing is written until the first user or
  assistant message. Writes are batched on a 100 ms flush timer, so the file on
  disk lags the live conversation by up to ~100 ms (plus OS buffering).
- `progress` entries are never persisted. Readers must treat unknown `type`
  values as skippable — the entry union grows between versions (2.1.220
  already writes types absent from the leaked source).
- Mainframe consumes this surface today — external-session scan, subagent JSONL
  fallback, todo files. This doc covers the format itself. (The
  `CONSUMED-SURFACE.md` inventory that assigns `CLAUDE-FILE-*` ids is not on
  `main` yet; see [Citations](#a-note-on-consumed-surface-citations).)

## Directory Layout

Source: `utils/sessionStorage.ts` (`getProjectsDir`, `getProjectDir`,
`getTranscriptPath`, `getAgentTranscriptPath`), `utils/toolResultStorage.ts`
(`getToolResultsDir`). Layout confirmed on disk under 2.1.220.

```
~/.claude/
  history.jsonl                        # global prompt history (NOT the transcript)
  projects/
    <sanitized-cwd>/                   # one dir per project cwd
      <sessionId>.jsonl                # main-thread transcript
      <sessionId>/                     # per-session sidecar dir (created on demand)
        subagents/
          agent-<agentId>.jsonl        # subagent sidechain transcript
          agent-<agentId>.meta.json    # subagent metadata sidecar
          <subdir>/                    # optional nesting (agentTranscriptSubdirs)
        remote-agents/
          remote-agent-<taskId>.meta.json
        tool-results/
          <toolUseId>.txt|.json        # offloaded oversized tool results
      sessions-index.json              # present in SOME project dirs — see Drift
```

### Path sanitization

`sanitizePath` (`utils/sessionStoragePortable.ts:311-319`): every character
outside `[a-zA-Z0-9]` becomes `-`; results longer than
`MAX_SANITIZED_LENGTH = 200` are truncated and suffixed with a `Bun.hash`
base-36 hash. So `/Users/doru/Projects/qlan/mainframe` →
`-Users-doru-Projects-qlan-mainframe` (leading `-` included, from the leading
`/`). Confirmed on disk.

Consequence for Mainframe: the mapping cwd → directory is **lossy** (`/a/b`
and `/a-b` collide). Mainframe's external-session scan already treats the
directory name as opaque and reads `cwd` from entries instead — keep doing
that.

**Undocumented divergence — the truncation branch is unimplemented.** Mainframe
reimplements `sanitizePath` twice (`transcript.rs:17-28::encode_project_path`
and `external_session_paths.rs:32-36::encode_path`), and **neither truncates at
200 chars nor appends the hash suffix**. Both stop at the character
substitution. Below 200 sanitized characters the three implementations agree;
past it, Mainframe derives a path the CLI never wrote. The two Rust copies also
differ trivially from each other (one preserves `-` explicitly, the other maps
it through the substitution to the same `-`), so they agree with each other but
not with the CLI. Only bites deeply nested project paths — recorded here
because this doc is the right place to say the branch is missing.

### Transcript path resolution

**Leak state** (`utils/sessionStorage.ts`): `getTranscriptPath()` =
`<projectDir>/<sessionId>.jsonl` where `projectDir` prefers an explicit
session project dir override and falls back to
`getProjectDir(getOriginalCwd())`. The **original** cwd is used — `cd` during
a session does not move the transcript.

**2.1.220 diverges for worktrees: the transcript file moves.** Do not assume
the leak's original-cwd rule holds. A session that enters a worktree writes a
`{"type":"relocated","relocatedCwd":"…","sessionId":"…"}` entry and its
transcript then lives under the **worktree's** sanitized project dir, not the
original cwd's. Verified on disk (drift row 5):

```
~/.claude/projects/-Users-…-DBricks-Optimizer--claude-worktrees-ai-other-serving-type-fallback/
  4dfe0dfd-ab94-41c2-8242-c5e390cfa17a.jsonl     # 477 lines
```

The first 86 entries carry the *original* cwd
(`/Users/…/DBricks_Optimizer`); a `relocated` entry appears at line 110; the
remaining 286 entries carry the worktree cwd. The original project dir
(`-Users-…-DBricks-Optimizer/`) holds **zero** files for that session id — the
whole file was moved, not forked. `relocated` entries are re-appended on
subsequent writes (×22 in this file), so treat them as last-wins, not once.

Consequence for Mainframe: deriving the transcript directory from the chat's
stored project path misses a relocated transcript entirely
(`packages/core-rs/crates/mainframe-adapter-claude/src/transcript.rs::get_session_jsonl_path`
does exactly this). A reader that cannot find `<sessionId>.jsonl` under the
derived dir must fall back to scanning sibling project dirs, or follow a
`relocated` entry when it has already opened the file.

`worktree-state` entries still record the worktree session object; they are
independent of `relocated` and do not move anything.

## Write Semantics

Source: `utils/sessionStorage.ts` (`Project` class).

| Behavior | Detail | Source |
|----------|--------|--------|
| Lazy materialization | Entries buffer in `pendingEntries` until the first user/assistant message; a session that never gets one writes no file | `Project` buffering logic |
| Flush cadence | Batched appends every `FLUSH_INTERVAL_MS = 100` (10 ms in remote mode) | `sessionStorage.ts:530,567` |
| Append-only | Entries are only appended; "updates" (titles, tags) are new lines, last-wins per type | `appendEntry` dispatch |
| Metadata re-append | On cleanup, `reAppendSessionMetadata()` re-writes customTitle/tag/etc. so they stay within the 64 KB tail window that `readLiteMetadata` scans | `sessionStorage.ts` |
| Read cap | `MAX_TRANSCRIPT_READ_BYTES = 50 MB` — the CLI itself refuses to load more; files can grow to multiple GB | `sessionStorage.ts:229` |
| Progress excluded | `isChainParticipant()` = `type !== 'progress'`; progress entries never persist and never join the `parentUuid` chain | `sessionStorage.ts` |

Consequences for Mainframe:

- A "session exists" check based on file presence has a window where the
  session is live but the file is absent (before first message + up to 100 ms).
- Metadata like `custom-title` can appear **twice** (original + re-append);
  readers must take the last occurrence.
- Scanning only a file's tail (like the CLI's own lite reader) is legitimate:
  the CLI actively maintains the invariant that session metadata lives in the
  last 64 KB.

## Entry Union

Source: `types/logs.ts:297-317` (`Entry`). The JSONL line's `type` field
discriminates. Verified subset on disk (2.1.220): `user`, `assistant`,
`system`, `attachment`, `queue-operation`, `last-prompt`, `mode`, `pr-link`,
`file-history-snapshot`, plus `permission-mode` and `relocated` (both
binary-only, see Drift).

### Conversation messages (`TranscriptMessage`)

`types/logs.ts:8-17,221-231`. `type` is `user` | `assistant` | `attachment` |
`system` (`isTranscriptMessage()`); the payload is the API `Message` plus:

| Field | Meaning |
|-------|---------|
| `uuid`, `parentUuid` | Chain linkage; `parentUuid: null` starts a chain. `logicalParentUuid` preserves lineage across session breaks |
| `sessionId`, `timestamp`, `version`, `cwd`, `gitBranch` | Ambient context; `version` is the CLI version that wrote the line — use it to detect format generation |
| `userType` | `"external"` for normal users |
| `entrypoint` | `CLAUDE_CODE_ENTRYPOINT` — `cli`, `sdk-cli`, `sdk-ts`… Mainframe-spawned sessions show `sdk-cli` (confirmed on disk) |
| `isSidechain` | `true` in subagent transcripts |
| `agentId` | Present in sidechain entries — links to the agent (see Subagents) |
| `slug` | Session slug used for plan files / resume |
| `promptId` | OTel correlation for user prompts |

Slash commands appear as user messages whose text is the XML wrapper the CLI
generates (confirmed on disk):
`<command-message>todo-triage</command-message>\n<command-name>/todo-triage</command-name>`.
This wrapper is **output-only** — see SLASH_COMMANDS.md.

### Metadata entries

All from `types/logs.ts`; each carries `sessionId` and is last-wins within its
type unless noted.

| `type` | Purpose |
|--------|---------|
| `summary` | Compaction/branch summary; `leafUuid` points at the message it summarizes |
| `custom-title` / `ai-title` | User rename vs AI-generated title; user titles always win on read |
| `last-prompt` | Latest user prompt (for `/resume` listings) |
| `task-summary` | Periodic "what is the agent doing" summary for `claude ps` |
| `tag` | Searchable session tag |
| `agent-name` / `agent-color` / `agent-setting` | Agent identity (from `/rename`, swarm, `--agent`) |
| `pr-link` | `{prNumber, prUrl, prRepository, timestamp}` — GitHub PR association (Mainframe consumes this, PR_TRACKING) |
| `mode` | `coordinator` \| `normal` |
| `worktree-state` | `PersistedWorktreeSession \| null` — last-wins; null = exited the worktree |
| `queue-operation` | Message-queue ops (`enqueue`/…) with timestamp |
| `file-history-snapshot` | Rewind/checkpoint file snapshots (`messageId`, `snapshot`, `isSnapshotUpdate`) |
| `attribution-snapshot` | Per-file Claude-contribution tracking for commit attribution |
| `speculation-accept` | Speculative-decoding acceptance metric |
| `content-replacement` | Records tool-result offloading decisions so resume rebuilds the exact prompt bytes (see Tool-result offloading) |
| `marble-origami-commit` / `marble-origami-snapshot` | Context-collapse (deliberately obfuscated discriminators); internal-build feature |

Readers must skip unknown types: the union is open in practice (see Drift).

## Subagent Sidechains

Source: `sessionStorage.ts` (`getAgentTranscriptPath`, `AgentMetadata`);
confirmed on disk.

- Sidechain transcript: `<projectDir>/<sessionId>/subagents/agent-<agentId>.jsonl`.
  Entries are ordinary `TranscriptMessage`s with `isSidechain: true` and
  `agentId` set (e.g. `"agentId":"a0771ff0d2771c7b8"` — a 17-hex id, not a
  UUID).
- Metadata sidecar `agent-<agentId>.meta.json`. Leaked type:
  `{agentType, worktreePath?, description?}`. On disk 2.1.220 additionally
  carries `toolUseId` (the spawning `toolu_…` id) and `spawnDepth` — see
  Drift. `toolUseId` is the robust join key back to the parent's Task tool
  call; Mainframe currently joins via `toolUseResult.agentId`
  (`history_subagents.rs:131-133`), which remains valid.
- Remote agents get only a meta file:
  `<sessionId>/remote-agents/remote-agent-<taskId>.meta.json`.
- The CLI never streams grandchildren over stream-json (nested subagents do
  not appear in the parent's event stream); their sidechains still exist on
  disk under optional nested subdirs.

## Tool-Result Offloading (`tool-results/`)

Source: `utils/toolResultStorage.ts` (read in full).

When a tool result exceeds its persistence threshold (per-tool
`maxResultSizeChars` clamped by a 50k default; GrowthBook can override), the
CLI writes the full content to
`<projectDir>/<sessionId>/tool-results/<toolUseId>.txt` (`.json` for
block-array content) and replaces the in-context content with a stub:

```
<persisted-output>
Output too large (N MB). Full output saved to: <filepath>

Preview (first 2.0KB):
...
</persisted-output>
```

- Files are written once (`wx` flag) — `toolUseId` is unique and content
  deterministic.
- A separate **per-message aggregate budget** (feature-flagged,
  `tengu_hawthorn_steeple`) can offload additional results; each such decision
  is recorded as a `content-replacement` transcript entry storing the exact
  replacement string, so resume replays byte-identical prompts (prompt-cache
  stability).
- `Read` results are exempt (threshold `Infinity`).

Consequence for Mainframe: when re-rendering a transcript, a tool result whose
content starts with `<persisted-output>` is a stub; the full output is at the
embedded absolute path (which may since have been deleted — the dir lives
under `~/.claude`, not the project). Mainframe currently renders the stub
as-is, which is acceptable.

## `~/.claude/history.jsonl` (not the transcript)

Source: `history.ts` (read in full). Global prompt history shared across all
projects — powers the composer's up-arrow, nothing else.

- Entry: `{display, pastedContents, timestamp, project, sessionId?}`; capped at
  `MAX_HISTORY_ITEMS = 100`; pasted content truncated to 1024 chars; file mode
  `0o600`; lockfile-guarded appends.
- Suppressed when `CLAUDE_CODE_SKIP_PROMPT_HISTORY` is truthy — Mainframe could
  set this to keep daemon-driven prompts out of the user's interactive
  up-arrow history (adoption candidate, not currently set).

## Drift (leak → v2.1.220)

Claims below are binary-artifact observations (live files written by 2.1.220
or nearby versions), not source reads.

| # | Observation | Leak status |
|---|-------------|-------------|
| 1 | `{"type":"permission-mode","permissionMode":"bypassPermissions","sessionId":…}` entries on disk | Absent from the leaked `Entry` union — new entry type. Readers keying on the leaked union must skip unknowns |
| 2 | `last-prompt` on disk = `{type, lastPrompt, leafUuid, sessionId}` | Leaked `LastPromptMessage` lacks `leafUuid` — field added post-leak |
| 3 | `agent-*.meta.json` on disk carries `toolUseId` and `spawnDepth` | Leaked `AgentMetadata` lacks both — additive |
| 4 | `sessions-index.json` exists in 14 project dirs (not all — absent for the mainframe project dir) | **A removed legacy artifact, not a new one.** `sessions-index` appears 0× in the leaked source *and* 0× in the 2.1.220, 2.1.219 and 2.1.218 binaries; all 14 on-disk files carry mtimes of 2026-01-20 – 2026-02-17, *predating* the 2026-03-31 leak snapshot. Nothing writes it anymore. **Never rely on it**; scan `*.jsonl` (matches Mainframe's existing external-sessions decision) |
| 5 | `{"type":"relocated","relocatedCwd":"…","sessionId":"…"}` entries, and the transcript file itself living under the *worktree's* project dir (see [Transcript path resolution](#transcript-path-resolution)) | Absent from the leaked `Entry` union (`types/logs.ts:297-317`); `relocated` appears in the leak only as an unrelated local variable (`utils/messages.ts:2301`). `relocatedCwd` occurs ×26 in the 2.1.220 binary — new entry type **and** a behavioral change to path resolution |

Note on row 4's evidence: absence from the leak alone cannot date a file. The
binary counts and the on-disk mtimes are what establish direction — a claim
sourced only to the leak would have gotten this backwards.

Non-drift note: the `<sessionId>/tool-results/` directory looked binary-only at
first sight but is fully explained by the leaked `toolResultStorage.ts`.

## What Mainframe's Adapter Should Rely On

1. **Stable:** path scheme (`projects/<sanitized-cwd>/<sessionId>.jsonl`), the
   conversation-entry envelope (`uuid`/`parentUuid`/`sessionId`/`timestamp`/
   `version`), `isSidechain`+`agentId`, the subagents/tool-results layout, and
   append-only last-wins metadata semantics.
2. **Open-ended:** the `type` union. Parse defensively; skip unknown types;
   never exhaustively match.
3. **Do not** treat file presence as session existence (lazy materialization)
   or assume one metadata line per type (re-append duplicates).
4. **Do not** treat the project directory as fixed for the life of a session.
   A worktree session relocates its transcript (drift row 5); a lookup that
   derives the directory from a stored project path must tolerate a miss and
   fall back to a scan.
5. **Do not** parse `sessions-index.json` — nothing has written it since early
   2026 and it was never in the leaked source.
6. The per-line `version` field is the correct signal for format-generation
   checks if Mainframe ever needs migration logic.

## A note on CONSUMED-SURFACE citations

Earlier drafts of this doc cited stable ids (`CLAUDE-FILE-01..08`) from a
`docs/research/adapters/claude/CONSUMED-SURFACE.md` inventory. That file exists only on
the unmerged branch `todo/239-changelog-watch-skill` (PR #518, open), so the
ids do not resolve for anyone reading from `main`. They have been replaced with
direct source citations. Reinstate the ids once #239 merges.

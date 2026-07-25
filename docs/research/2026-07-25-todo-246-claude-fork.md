# Claude CLI — forking a conversation

How the Claude CLI branches a conversation: what `/branch` writes to the session
JSONL, what `/fork` actually is (not what the todo assumed), the headless
`--fork-session` / `--resume-session-at` recipe, and what Mainframe would have to
build to offer "fork this chat". Answers todo #246.

Sources, in descending authority:

1. **Installed binary v2.1.219** (`~/.local/share/claude/versions/2.1.219`,
   Mach-O arm64 with an embedded JS bundle). This is the version Mainframe's
   daemon spawns. The bundle is minified, so citations are **searchable literal
   strings** rather than line numbers — see
   [Reproducing the binary citations](#reproducing-the-binary-citations). Minified
   symbol names (`sXd`, `gXd`, …) are build-specific and will differ in other
   versions.
2. **Live experiment** against 2.1.219 in a throwaway project dir, reading the
   resulting `~/.claude/projects/<encoded-cwd>/*.jsonl` files. Marked
   *(verified)*.
3. **Leaked TypeScript source** (`~/Projects/qlan/claude-code/src/`, 2026-03-31
   npm source-map leak — roughly the 2.0.x line). Readable, but **stale on this
   topic**: the fork surface changed substantially between the leak and 2.1.219.
   Every divergence is called out.
4. **`@anthropic-ai/claude-agent-sdk@0.3.219`** typings (`sdk.d.ts`), which ship
   in lockstep with CLI 2.1.219 and document the same code.

## TL;DR

- **The todo's premise is wrong on one point.** `/fork` is *not* an alias of
  `/branch` in 2.1.219. The alias existed in the leaked source and is gone. In
  2.1.219 `/fork` spawns a **background session** (default) or a background
  agent (fallback); the resumable-branch command is **`/branch`** only.
- **The default `/fork` is worth a product look.** On default settings the
  registry ships `gXd` — *"Copy this conversation into a new background session
  and keep working here"* — which is close to the UX Mainframe wants. See
  [The default `/fork` is `gXd`](#the-default-fork-is-gxd-and-it-matters).
- **`/branch`** copies the current transcript into `<newUuid>.jsonl` in the same
  project dir, re-stamps `sessionId`, rebuilds the `parentUuid` chain, keeps the
  original message `uuid`s, stamps every entry with
  `forkedFrom: { sessionId, messageUuid }`, and titles the fork
  `"<first prompt> (Branch)"` — or the caller's `[name]` verbatim, with no
  suffix. The original file is untouched. It always forks at the **tail** —
  there is no interactive mid-history fork.
- **Headless forking works.** The exact recipe is
  `claude --resume <sourceId> --fork-session --session-id <newUuid>`. *(verified)*
  The CLI's own background-session feature builds precisely this argv, so it is
  the CLI's internal recipe rather than a workaround — though only
  `--fork-session` and `--session-id` appear in `claude --help`.
- **Headless can fork mid-conversation**, which the interactive command cannot:
  add `--resume-session-at <assistantMessageUuid>` to truncate the inherited
  transcript at that message (inclusive). *(verified)*
- **The headless fork does not write `forkedFrom`.** It is a re-stamped replay,
  not a marked branch. A host app that wants lineage must record it itself.
- **`--resume-session-at` without `--fork-session` is destructive-ish**: the new
  turn is appended *into the original file* chained off the fork point, creating a
  second branch. The original tail survives on disk but is no longer the leaf, so
  a plain `--resume` will never reach it again. *(verified)* Mainframe must never
  send that combination.
- **New since the leak:** the Agent SDK now exports a real
  `forkSession(sessionId, { upToMessageId, title, dir })`. The leaked source
  threw `'forkSession is not implemented in the SDK'`
  (`entrypoints/agentSdkTypes.ts:268-272`). It is implemented now, writes proper
  `forkedFrom` markers *with regenerated UUIDs*, and needs no CLI process.
- **Mainframe recommendation:** use the `--fork-session` flag path (not the SDK,
  not a hand-rolled JSONL copy), and let the CLI mint the fork file on the first
  turn. See [Recommendation](#recommendation-for-mainframe).

## Three unrelated things called "fork"

2.1.219 overloads the word. Conflating them is the main trap in this area.

| Name | What it is | Produces |
|------|-----------|----------|
| `/branch` | Slash command. Copies the conversation into a new **resumable top-level session** | A new `<uuid>.jsonl` |
| `/fork`, `/subtask` | Slash commands. Two `/fork` variants are compiled in. **On default settings the registry takes `gXd`**: *"Copy this conversation into a new background session and keep working here."* The fallback `mXd` (*"Spawn a background agent that inherits the full conversation"*) ships only when agent view is disabled | A background session (default) or a subagent (fallback) — not a resumable branch in the `/branch` sense |
| `--fork-session` | CLI flag. On resume, keep a **new session id** instead of writing back to the source | A new `<uuid>.jsonl` |

Only rows 1 and 3 are "fork the conversation" in the todo's sense — but row 2's
default variant is closer than its name suggests, and
[deserves a second look](#the-default-fork-is-gxd-and-it-matters).
`docs/adapters/claude/PREBUILT_PROMPTS_CATALOG.md:123`
(`/fork | Spawn a background agent that inherits the full conversation`) is
verbatim `mXd` — the *non-default* variant. That file is
[not in the repo](#against-the-repos-existing-adapter-docs); it exists only on
the machine this research was done on.

### The `/fork` alias: what changed

Leaked source, `commands/branch/index.ts:4-12`:

```ts
const branch = {
  type: 'local-jsx',
  name: 'branch',
  // 'fork' alias only when /fork doesn't exist as its own command
  aliases: feature('FORK_SUBAGENT') ? [] : ['fork'],
  description: 'Create a branch of the current conversation at this point',
  ...
}
```

In 2.1.219 the `FORK_SUBAGENT` build flag is compiled **on**, so the alias is
gone. The binary's `/branch` definition carries no `aliases` key at all:

```
name:"branch",description:"Create a branch of the current conversation at this point",argumentHint:"[name]",load:...
```

and two distinct `/fork` commands exist, selected at registry-build time (search
`BH()&&!Yt(`):

```js
...BH()&&!Yt(Z.IS_DEMO)?[gXd,SXd]:[mXd],
```

Both definitions are found by searching `name:"fork",description:`:

- `mXd` — *"Spawn a background agent that inherits the full conversation"*,
  `argumentHint:"<directive>"`.
- `gXd` — *"Copy this conversation into a new background session and keep working
  here"*, `argumentHint:"[prompt]"`, shipped alongside `SXd` = `/subtask`.
- Both are gated `isEnabled: () => !By()`, where `By()` is coordinator mode
  (search `CLAUDE_CODE_COORDINATOR_MODE`). `BH()` is `!Yer()` — the agent-view
  gate, disabled by `CLAUDE_CODE_DISABLE_AGENT_VIEW` or the `disableAgentView`
  setting (search `disableAgentView`).

Both variants' failure messages point users at `/branch` for real branching:
*"Forking is not available in coordinator sessions. Use /branch instead."*

### The default `/fork` is `gXd`, and it matters

Which variant ships is decided at build time by `BH()`, and the chain resolves
without needing a runtime experiment:

```js
function BH()  { return !Yer() }
function Yer() { return uXi() !== null }
function uXi() {
  if (Yt(process.env.CLAUDE_CODE_DISABLE_AGENT_VIEW)) return "is disabled by CLAUDE_CODE_DISABLE_AGENT_VIEW";
  if (SI()?.settings.disableAgentView === true)       return "is disabled by the 'disableAgentView' setting";
  return null;
}
```

`uXi()` returns non-null **only** under `CLAUDE_CODE_DISABLE_AGENT_VIEW` or the
`disableAgentView` setting. On default settings it returns `null`, so `BH()` is
true and the registry takes `[gXd, SXd]`. **The `/fork` most users see is
`gXd`: "Copy this conversation into a new background session and keep working
here."** `mXd` — the background *agent* — is the fallback for installs that
have turned agent view off — and it is the only variant
`PREBUILT_PROMPTS_CATALOG.md:123` documents (a
[local-only file](#against-the-repos-existing-adapter-docs), not a repo doc).

This is the most product-relevant finding in this doc. `gXd`'s described
behavior — copy the conversation into a new session, leave the user where they
are — is close to what a Mainframe "fork this chat" affordance should do, and
it means the CLI already ships a first-class UX for it. `gXd`'s definition
carries no `load:` key (unlike `mXd`), so its execution path is wired
elsewhere; tracing it is the obvious follow-up if Mainframe wants to mirror the
interaction rather than only the file mechanics.

## The interactive fork: `/branch`

Implementation: `commands/branch/branch.ts` in the leak; in 2.1.219 the same
module, minified as `Gqs` with exports `createFork` (`sXd`), `branchAndResume`
(`aXd`), `deriveFirstPrompt` (`iXd`), `call` (`MOy`) — search
`createFork:()=>sXd`.

2.1.219 rewrote it as a streaming read/write (`createReadStream` + `readline` +
`createWriteStream`) instead of the leak's read-whole-file-into-memory, and added
a few fields. The shape is otherwise the same.

### What it writes, per entry

For each entry in the current in-memory conversation, `/branch` writes one JSONL
line to the new file (2.1.219, `forkedFrom:{sessionId:o,messageUuid:A.uuid}`):

```js
D = { ...A, ...I, sessionId: n, parentUuid: T, isSidechain: false,
      sessionKind: undefined,
      forkedFrom: { sessionId: o, messageUuid: A.uuid } }
```

| Field | Behavior |
|-------|----------|
| `sessionId` | Replaced with the new fork UUID |
| `uuid` | **Preserved** (spread from the source entry) — so `forkedFrom.messageUuid === uuid` |
| `parentUuid` | Rebuilt as a linear chain over the copied entries; `progress` entries do not advance the chain |
| `isSidechain` | Forced `false`; sidechain entries are filtered out entirely before the loop |
| `sessionKind` | Cleared |
| `forkedFrom` | `{ sessionId: <original>, messageUuid: <original entry uuid> }` |
| `neutralizedByFork` | Added (`true`) on `system` entries with `subtype === 'model_refusal_fallback'` — new in 2.1.219, absent from the leak |
| everything else | Preserved verbatim: `timestamp`, `cwd`, `gitBranch`, `version`, `userType`, `entrypoint` |

Non-message entries are handled separately:

- **`content-replacement`** — records from the source session are collected and
  re-emitted as a single entry stamped with the fork's `sessionId`. The leak's
  comment (`branch.ts:98-104`) explains why this matters: without it,
  `claude -r <forkId>` rebuilds an empty replacements map, previously-elided
  `tool_result` blocks are reclassified as FROZEN and re-sent in full — a
  permanent prompt-cache miss and token overage on every subsequent turn.
- **`relocated`** — the source's `relocatedCwd` is carried over (2.1.219 only;
  not in the leak).

### Session id, title, and what happens next

- **New session id**: `randomUUID()`, written to
  `<projectDir>/<forkSessionId>.jsonl`, mode `0600`, project dir `0700`.
- **Original file**: never read-modify-written, never deleted. Both sessions
  remain independently resumable.
- **Title**: the `" (Branch)"` suffix applies **only when no name is given**.
  `branchAndResume` picks
  `p = s?.replace(/\s+/g," ").trim() ?? await LOy(d)`, where `s` is the
  `/branch [name]` argument, `d` is `deriveFirstPrompt` (first user message,
  whitespace collapsed, 100 chars, fallback `'Branched conversation'`), and
  `LOy` (`getUniqueForkName`) is the function that appends the suffix. So
  `/branch my-name` titles the fork `my-name`; a bare `/branch` titles it
  `"<first prompt> (Branch)"`. Collisions on the auto path get `" (Branch 2)"`,
  `" (Branch 3)"`… 2.1.219 persists the title through two calls (`zse` then
  `Y1t`) with a `"user" | "auto"` provenance tag — `f = s ? "user" : "auto"`,
  the same branch point; the leak had one call (`saveCustomTitle`).
- **Analytics**: `logEvent('tengu_conversation_forked', { message_count, has_custom_title })`.
- **Then it resumes into the fork** via `context.resume(sessionId, forkLog, 'fork')`,
  printing (2.1.219): *"Branched conversation. You are now in the new branch
  (session `<id>`). Use /resume `<orig>` to return to the original, or run
  `claude -r <orig>` in a new terminal."*

### Fork point: tail only

`/branch` forks from `e.messages` — the live in-memory conversation. There is no
argument, picker, or message-id parameter; `argumentHint` is `[name]`. **The
interactive fork point is always the current tail.** Mid-history branching is
`/rewind`'s job (see [Related mechanisms](#related-mechanisms)).

## The headless fork

This is the payoff. It works, and it is the CLI's own internal recipe — not a
workaround. "Documented" would be too strong: `--fork-session` and
`--session-id` appear in `claude --help`, but `--resume-session-at`,
`--reply-on-resume`, and `--rewind-files` are all `hideHelp()` and do not.

### Flag reference (2.1.219, string-verified)

| Flag | Help text |
|------|-----------|
| `--fork-session` | *"When resuming, create a new session ID instead of reusing the original (use with `--resume` or `--continue`)"* |
| `--session-id <uuid>` | *"Use a specific session ID for the conversation (must be a valid UUID)"* |
| `--resume-session-at <message id>` | *"When resuming, only messages up to and including the assistant message with `<message.id>` (use with `--resume` in print mode)"* — `hideHelp()`, so it does not appear in `claude --help` |
| `--reply-on-resume` | *"When resuming, immediately query if the loaded transcript ends in a user-role message (set by `/background` mid-turn so the fork continues the in-flight turn)."* |
| `--rewind-files <user-message-id>` | *"Restore files to state at the specified user message and exit (requires `--resume`)"* — filesystem only, no transcript effect |

### Valid combinations

Validated at startup (search `` Error: Session ID ${jt} is already in use. `` —
the plain error strings also live in the binary's string table, which `find`
hits first):

```js
if (C) { // --session-id
  if ((t.continue || t.resume) && !t.forkSession)
    return hs("Error: --session-id can only be used with --continue or --resume if --fork-session is also specified.");
  if (!de) { // de = t.sdkUrl ?? undefined
    let jt = kN(C);
    if (!jt) return hs("Error: Invalid session ID. Must be a valid UUID.");
    if (!(t.forkSession && t.resume === jt) && vfn(jt))
      return hs(`Error: Session ID ${jt} is already in use.`);
  }
}
```

Note the `if (!de)` wrapper: under `--sdk-url` the UUID check and the in-use
check are both skipped, and only the first error survives. Mainframe never
passes `--sdk-url` (it appears nowhere in the repo), so the table below and the
[guardrails](#sketch) hold as written — but the escape exists.

Plus `Error: --resume-session-at requires --resume` (search
`Error: --resume-session-at requires --resume`; leak: `cli/print.ts:567-568`).

| Combination | Result |
|-------------|--------|
| `--resume <id>` | Continue in place. Writes back into `<id>.jsonl`. |
| `--resume <id> --fork-session` | Fork. New session id is the process's fresh startup UUID (random). |
| `--resume <id> --fork-session --session-id <new>` | **Fork with a caller-chosen id.** `<new>` must be a valid UUID and must not already be in use. |
| `--continue --fork-session [--session-id <new>]` | Same, sourcing the most recent session in the cwd. |
| `--resume <id> --resume-session-at <msgUuid> --fork-session --session-id <new>` | **Mid-conversation fork.** |
| `--session-id <new>` alone (no resume/continue) | Fresh session with a chosen id. |
| `--session-id <new>` + resume/continue **without** `--fork-session` | Hard error. |
| `--resume-session-at` without `--resume` | Hard error. |
| `--resume <id> --resume-session-at <msgUuid>` **without** `--fork-session` | **Do not use.** Branches inside the original file — see below. |

### How the copy actually happens

The headless fork does **not** call the `/branch` copier. The mechanism is a
side effect of ordinary transcript persistence:

1. `loadInitialMessages` reads the source transcript into memory
   (`cli/print.ts:5029-5103`).
2. If `--resume-session-at` is set, the in-memory array is truncated:
   `result.messages = result.messages.slice(0, index + 1)`, where `index` is the
   position of the entry whose `uuid` matches. A miss is fatal:
   `No message found with message.uuid of: <id>` (`cli/print.ts:5105-5120`).
3. `if (!options.forkSession && result.sessionId) switchSession(...)` — with
   `--fork-session` this is **skipped**, so the process keeps its fresh session
   id and its fresh, empty transcript path (`cli/print.ts:5148-5156`; interactive
   equivalent `utils/sessionRestore.ts:435-451`).
4. On the first turn, `recordTranscript(mutableMessages)` writes the whole
   in-memory array. It dedups against `getSessionMessages(<currentSessionId>)`
   (`utils/sessionStorage.ts:1416-1431`) — which is **empty** for a fresh id — so
   every inherited message is written out. `appendMessages` re-stamps
   `sessionId`, `cwd`, `version`, `gitBranch`, `userType`, `entrypoint` after the
   spread (`utils/sessionStorage.ts:1039-1064`, with an explicit comment naming
   `--fork-session` as the reason the ordering matters).

Two consequences fall straight out of this design:

- **No `forkedFrom` markers.** Nothing in this path writes them. *(verified)*
- **The fork file does not exist until the first turn completes.** There is no
  "fork now, prompt later" headless call.

`--fork-session` also strips `worktreeSession` from the restored metadata
(`sessionRestore.ts:470-472`), on the reasoning that a fork must not inherit
ownership of the original's git worktree — a "Remove" on the fork's exit dialog
would delete a worktree the original still references. `content-replacement`
records *are* re-seeded on the fork path (`sessionRestore.ts:452-463`).

### Verified end to end

Run against 2.1.219 in `/tmp/forktest.MvEX` on 2026-07-25, `--model haiku`.

**Baseline.** `claude -p "Reply with exactly: ALPHA" --output-format json` →
`session_id 219f3e71-…`. File `~/.claude/projects/-private-tmp-forktest-MvEX/219f3e71-….jsonl`,
10 lines: `queue-operation` ×2, `user`, `attachment` ×4, `assistant` ×2,
`last-prompt`.

**Tail fork.**

```
claude -p "Reply with exactly: BETA" --output-format json \
  --resume 219f3e71-c383-4ab1-8514-30719df6cc1e \
  --fork-session --session-id dcb069d5-0ffe-49f3-9199-565329036800
```

Reported `session_id` = `dcb069d5-…` (the id we chose). A new
`dcb069d5-….jsonl` appeared; the source file's size and mtime were unchanged. The
new file contains all inherited entries with **original `uuid`s preserved**,
`sessionId` rewritten to `dcb069d5`, the `parentUuid` chain intact, and
**`forkedFrom` absent on every entry**, followed by the new turn chained off the
inherited tail.

One entry is added rather than inherited: the fork file **opens with a `mode`
record** the source does not have —
`{"type":"mode","mode":"normal","sessionId":"<forkId>"}`. It is one of the
session-scoped metadata types (`"type":"mode"` is in `METADATA_TYPE_MARKERS`,
`utils/sessionStorage.ts:3113-3123`), written on the fresh session rather than
copied. Harmless, but a parser that assumes the first line of a fork mirrors the
first line of its source will trip on it.

**Mid-conversation fork**, cutting at the *first* assistant message
`83c5c212-…` (the source has two):

```
claude -p "Reply with exactly: GAMMA" --output-format json \
  --resume 219f3e71-… --resume-session-at 83c5c212-9797-4175-a8d2-a98951cfe7bb \
  --fork-session --session-id 6256a01f-…
```

The resulting `6256a01f-….jsonl` ends its inherited section at `83c5c212`; the
second assistant message `ea09fc54` is **absent**, and the new user message
chains directly off `83c5c212`. Mid-conversation headless forking works.

**The dangerous combination.** Same `--resume-session-at`, no `--fork-session`:

```
claude -p "Reply with exactly: DELTA" --resume 219f3e71-… \
  --resume-session-at 83c5c212-…
```

`session_id` came back as `219f3e71-…` (unchanged) and the source file grew from
10 to 17 lines. The new user message `d5b8dead` carries
`parentUuid: 83c5c212` — a **second branch inside the original file**. The old
tail `ea09fc54` still sits on disk but is no longer the leaf, so subsequent
`--resume 219f3e71-…` walks the new branch and can never reach it again. Not
data loss, but irreversible from the CLI's own interface.

### The CLI uses this recipe itself

Background-session launch (search `e.launch.fork?`):

```js
if (e.launch.mode === "resume")
  return kfe([...e.launch.fork ? ["--session-id", e.sessionId, "--fork-session"] : [],
              "--resume", e.launch.transcriptPath ?? e.launch.sessionId, ...]);
```

Exactly `--session-id <new> --fork-session --resume <source>`. This is the
sanctioned way to fork headlessly, straight from the CLI's own code. Note
`--resume` accepts a **transcript path** as well as a session id, which is how
the CLI forks a session living in another project directory.

## The SDK `forkSession()` API

New since the leak, and a genuine third mechanism. The leaked source had a stub
that threw: `export async function forkSession(...) { throw new Error('forkSession is not implemented in the SDK') }`
(`entrypoints/agentSdkTypes.ts:268-272`). In 2.1.219 it is implemented
(search `forkSession: invalid sessionId`) and exported from the SDK entry module
alongside `query`, `listSessions`, `getSessionMessages`, `renameSession`,
`deleteSession` (search `forkSession:()=>Djy`).

`@anthropic-ai/claude-agent-sdk@0.3.219` `sdk.d.ts:686-718`:

```ts
/**
 * Fork a session into a new branch with fresh UUIDs.
 *
 * Copies transcript messages from the source session into a new session file,
 * remapping every message UUID and preserving the parentUuid chain. Supports
 * `upToMessageId` for branching from a specific point in the conversation.
 *
 * Forked sessions start without undo history (file-history snapshots are not copied).
 */
export declare function forkSession(sessionId: string, options?: ForkSessionOptions): Promise<ForkSessionResult>;

export declare type ForkSessionOptions = SessionMutationOptions & {
  /** Slice transcript up to this message UUID (inclusive). If omitted, full copy. */
  upToMessageId?: string
  /** Custom title for the fork. If omitted, derives from original title + " (fork)". */
  title?: string
}
export declare type ForkSessionResult = { sessionId: string }
// SessionMutationOptions = { dir?: string; sessionStore?: SessionStore }
```

Implementation notes from the bundle (search
`forkedFrom:{sessionId:t,messageUuid:f.uuid}`), which differ from
`/branch` in ways that matter:

- **UUIDs are regenerated.** A `Map<oldUuid, newUuid>` is built, then
  `parentUuid` and `logicalParentUuid` are remapped through it. Because
  `forkedFrom.messageUuid` still holds the *original* uuid, lineage here is
  genuinely traceable — unlike `/branch`, where the two are equal by construction.
- **`progress` entries are dropped**, and `parentUuid` remapping walks past
  dropped ancestors.
- The **last** entry's `timestamp` is set to now; the rest keep theirs.
- Same stamping as `/branch` otherwise: `sessionId`, `isSidechain: false`,
  `teamName`/`agentName`/`sessionKind`/`slug`/`sourceToolAssistantUUID` cleared,
  `neutralizedByFork: true` on `model_refusal_fallback` system entries,
  `forkedFrom: { sessionId, messageUuid }`.
- `content-replacement` and `relocated` entries are carried over, plus a
  **`custom-title` entry** written directly into the JSONL:
  `title ?? \`${derived || 'Forked session'} (fork)\`` — note the suffix is
  `" (fork)"` here versus `" (Branch)"` for `/branch`.
- Validation: source id and `upToMessageId` must both be UUIDs
  (`forkSession: invalid sessionId (not a UUID)`); errors on
  `Session <id> not found`, `Session <id> has no messages to fork`,
  `Message <id> not found in session <id>`.
- Writes `<projectDir>/<newSessionId>.jsonl` and returns `{ sessionId }`. **No
  CLI process is spawned** — it is a pure file operation.

This is the cleanest mechanism on paper. It is also a Node dependency, which is
the reason it is not the recommendation below.

## Related mechanisms

Short notes only; per the todo, full coverage of rewind belongs to #241.

- **`/rewind` (`/checkpoint`)** — `commands/rewind/` — is the mid-history
  counterpart to `/branch`: it moves the conversation *and optionally the
  filesystem* back to an earlier point in the same session. Its headless
  slice is `--rewind-files <user-message-id>`, which restores files and exits
  (`requires --resume`, and cannot be combined with a prompt). It does not fork.
- **`/background` and `/fork`** create background sessions using the
  `--session-id … --fork-session --resume …` recipe above, plus
  `--reply-on-resume` when forking mid-turn.
- **`/clear`** (documented in `docs/adapters/claude/CLEAR.md`) is the degenerate
  case: new session id, *no* history copied.

## Against the repo's existing adapter docs

The doc set named in `CLAUDE.md` is `docs/adapters/claude/{PROTOCOL_REVERSED,
COMPACTION, INTERRUPT, CONTEXT_USAGE, MODELS, TODOS, PR_TRACKING}.md`. Cross-
checking turned up a housekeeping problem that outlives this todo.

**`docs/adapters/` is excluded from the repo.** `.git/info/exclude:15` carries
`/docs/adapters/`, under a "Private local files — not committed to public repo"
heading. The only tracked file under it is `CLEAR.md`
(`git ls-files docs/adapters/claude/` returns exactly that one path, added by
commit `83ffd385`). Everything else lives on this machine and nowhere else:

| Path | State |
|------|-------|
| `CLEAR.md` | Tracked. Real repo doc. Not linked from `CLAUDE.md`. |
| `COMPACTION.md`, `CONTEXT_USAGE.md`, `MODELS.md`, `PREBUILT_PROMPTS_CATALOG.md`, `init-command/README.md` | Present locally, git-excluded. Invisible to any other clone. |
| `PROTOCOL_REVERSED.md`, `INTERRUPT.md`, `TODOS.md`, `PR_TRACKING.md` | Do not exist anywhere — not tracked, and not on disk in the primary checkout either. |

Two consequences:

- **`PREBUILT_PROMPTS_CATALOG.md:123` is not a repo doc.** It is cited three
  times below as if it were; it is a local-only file, and the citations are
  reproducible only on this machine.
- **All seven `docs/adapters/` links in `CLAUDE.md` are dead** for anyone but
  this machine — three because the files are git-excluded, four because they
  were never written. Worth its own cleanup todo: either untrack the exclusion
  and commit the docs, or stop linking them from `CLAUDE.md`.

This is also why the present doc lives in `docs/research/` rather than
`docs/adapters/claude/`: anything written into `docs/adapters/` would be
silently excluded from the commit and would never reach the repo.

Findings (the three git-excluded docs were read in the primary checkout):

| Doc | Relationship |
|-----|--------------|
| `COMPACTION.md` | **Extends.** It covers resuming a compacted session but never mentions forking. Worth knowing: a fork inherits the source's `content-replacement` records, so a forked compacted session does not silently lose its elisions (`branch.ts:98-104`). |
| `CONTEXT_USAGE.md`, `MODELS.md` | **Neither confirms nor contradicts.** Zero overlap — no mention of sessions, resume, forking, or transcripts. |
| `CLEAR.md` | **Confirms and extends.** Its claims that each chat stores its CLI session id in `chats.claude_session_id` (`CLEAR.md:176`), that resume passes it as `--resume <id>` (`:178-181`), and that an old `<sessionId>.jsonl` stays a valid resume target (`:40`) all hold. Its proposal to persist parent lineage in a `parent_claude_session_id`-style column (`:210-218`), written for `/clear`, is **exactly the column a fork feature needs** — the two should share one design. |
| `PREBUILT_PROMPTS_CATALOG.md` (local-only) | **Documents the wrong variant.** Its `/fork` entry ("Spawn a background agent that inherits the full conversation", `:123`) is verbatim `mXd` — the fallback that ships only when agent view is disabled. The default `/fork` is `gXd`, ["Copy this conversation into a new background session and keep working here"](#the-default-fork-is-gxd-and-it-matters). If the file is ever committed, that line needs correcting. |
| `PROTOCOL_REVERSED.md`, `INTERRUPT.md`, `TODOS.md`, `PR_TRACKING.md` | Absent. |

**No existing repo doc mentions `/branch`, `--fork-session`, `--resume-session-at`,
or `forkedFrom`.** This is net-new ground.

## Recommendation for Mainframe

### Current state

- The Rust adapter builds argv in
  `packages/core-rs/crates/mainframe-adapter-claude/src/session.rs:345-388`
  (`build_args`), called from `spawn()` at `:540`. It passes `--resume <id>`
  when `resume_session_id` is set (`:393,419`), where that id is the chat's
  `claude_session_id`.
- **`--fork-session`, `--session-id`, `--continue`, and `--resume-session-at`
  appear nowhere in the repo** — not in Rust, TS, or docs.
- `chats` (`packages/core-rs/crates/mainframe-db/src/migrations.rs:52-66`, plus
  `ALTER TABLE` migrations 2-26, `LATEST_VERSION = 26` at `:448`) has exactly
  one `claude_session_id` per chat and **no lineage column**. The TS mirror is
  `packages/types/src/chat.ts:36-86`.
- `import_session` dedups 1:1 via `find_by_external_session_id`
  (`mainframe-db/src/chats.rs:608`;
  `mainframe-chat/src/external_session_service.rs:113-118`), so the data model
  currently assumes one chat per CLI session.
- The existing `POST /api/chats/{id}/fork-worktree`
  (`packages/core-rs/crates/mainframe-server/src/routes/worktree.rs:120,346` →
  `lifecycle_manager.rs:692-728`) is **not** a
  conversation fork despite the name — it creates a brand-new empty chat plus a
  git worktree. Name any new feature to avoid collision, e.g. `branch-chat`.

### Which mechanism

**Use `--fork-session`.** Rejected alternatives:

- *SDK `forkSession()`* — cleanest semantics (real `forkedFrom`, regenerated
  UUIDs, no process), but it is a Node/npm dependency. The Rust cutover
  (PR #510) deliberately removed the Node daemon and bundled Node; re-adding an
  npm package to fork a chat reverses that. Revisit only if the CLI ever exposes
  it as a subcommand.
- *Hand-rolled JSONL copy in Rust* — porting `/branch`'s copier means owning the
  transcript format: `content-replacement` re-stamping (get it wrong and every
  forked chat silently burns tokens forever), `relocated`, `neutralizedByFork`,
  the `progress` chain rule. The format is undocumented and moves between
  versions. Not worth it.

The flag path costs one extra argv pair, is the CLI's own internal recipe, and
degrades safely: on a CLI too old to know `--fork-session`, spawn fails loudly
rather than corrupting anything.

### Sketch

Add `POST /api/chats/{id}/branch` (body: optional `title`, optional
`resumeSessionAt`). The handler:

1. Reads the source chat. Require a non-null `claude_session_id`; a chat that has
   never run has nothing to fork.
2. Generates `new_session_id = Uuid::new_v4()`.
3. Creates a chat row inheriting `project_id`, `adapter_id`, `model`,
   `permission_mode`, `plan_mode`, `effort`/`fast`/`ultracode`/`adaptive_thinking`,
   and `worktree_path`/`branch_name` (see below); with
   `claude_session_id = new_session_id`, `title = "<source title> (branch)"`,
   `status = 'active'`, and fresh cost/token counters.
4. Records lineage — see the schema note below.
5. Extends `SessionSpawnOptions`
   (`packages/core-rs/crates/mainframe-types/src/adapter.rs:73-86`) with a
   `fork_from: Option<ForkFrom { source_session_id, resume_session_at }>`, and
   has `build_args` emit
   `--resume <source_session_id> --fork-session --session-id <new_session_id>`
   plus `--resume-session-at <uuid>` when present, *instead of* the plain
   `--resume` arm.

Guardrails worth encoding as invariants:

- **Never emit `--resume-session-at` without `--fork-session`.** Enforce it in
  `build_args`, not at the call site. This is the one combination that mutates
  the source transcript.
- **Only the source chat's `claude_session_id` may be a `--fork-session`
  source**, and the fork's id must be freshly minted — the CLI rejects a
  `--session-id` that is already in use.

### Schema

Add one column, `parent_claude_session_id TEXT` (migration 27), and mirror it on
`Chat` as `parentClaudeSessionId?`. Design it together with `CLEAR.md:210-218`,
which wants the same field for a different reason: after `/clear` the chat's
previous session id is orphaned. One nullable "previous/source session id"
column serves both. Add `fork_point_message_uuid TEXT` only if the UI needs to
show *where* a branch was taken.

Do not try to recognise forks by scanning transcripts for `forkedFrom`: the
headless path never writes it *(verified)*. Lineage in Mainframe must be
Mainframe's own record.

### What a forked chat inherits

| Inherits | Starts fresh |
|----------|--------------|
| Project, adapter, model, permission mode, plan mode, effort/fast/ultracode/adaptive-thinking | `id`, `claude_session_id`, `session_file_path` |
| Conversation history, up to the fork point | Cost and token counters — the fork's first turn re-sends the inherited prefix, so counters must not be double-counted from the source |
| Title, suffixed | `created_at` / `updated_at`, `pinned`, `automation_run_id` |
| Worktree/branch — **by policy, not by default** | `todos`, `detected_prs`, `mentions`, `modified_files`, `plan_files`, `skill_files` — all rebuilt from the fork's own stream |

**Worktree is the one real product decision.** The CLI deliberately strips
`worktreeSession` on fork (`sessionRestore.ts:470-472`) so the fork cannot
delete a worktree the original still owns. Mainframe has two options:

- *Share the worktree* (copy `worktree_path` / `branch_name`): matches "two
  chats, one branch, explore two directions" — but two live CLI processes then
  edit one working tree concurrently. Only safe if the source chat is idle.
- *Fresh worktree*: safe, and composes with the existing `fork-worktree` route.

Recommend **sharing the worktree only when the source chat is not running**, and
otherwise offering the fresh-worktree path. Whichever is chosen, the fork must
own its own worktree row so archive/remove semantics stay unambiguous.

### Limitations to put in the UI

1. **The fork's transcript does not exist until its first turn.** Between
   creation and the first message the chat has a `claude_session_id` pointing at
   no file. `transcript_missing` (migration 25) and
   `is_claude_transcript_present`
   (`mainframe-adapter-claude/src/transcript.rs`) must tolerate this, or a fresh
   branch will render as broken. This is the single most likely bug in the
   implementation.
2. **Mid-history fork points must be UUIDs from the source transcript**, and an
   assistant-message UUID is the conservative choice. The code is looser than
   the help text: `print.ts:5106-5112` matches
   `m.uuid === options.resumeSessionAt` against *any* transcript entry and
   slices there — nothing restricts it to assistant messages. Only the flag's
   help text says "assistant message", so treat that as the supported contract
   and don't rely on cutting at a `user` or `attachment` entry. Either way a
   miss is a fatal startup error, not a warning, so if Mainframe exposes "branch
   from here" the UUID must come from a transcript read, not from Mainframe's
   own message ids.
3. **Forks carry no undo history** — file-history snapshots are not copied
   (`sdk.d.ts:693-694`); `/rewind`'s file-restore is unavailable in a fork.
4. **No `forkedFrom` markers**, so the external-session scan
   (`packages/core-rs/crates/mainframe-adapter-claude/src/external_sessions.rs:34-201`
   — four files in the workspace share that basename) cannot tell a forked
   session from an ordinary one. An imported fork will look like an
   independent session with a
   suspiciously familiar history.
5. **Two encoders for the project-dir path already disagree** in this repo:
   `transcript.rs:17-43` keeps dashes, `external_session_paths.rs:31-36` does
   not. Fork work touching path resolution must pick deliberately.

## Open questions

- **How `gXd` actually behaves**, now that it is established as the default
  `/fork` (see [that section](#the-default-fork-is-gxd-and-it-matters)). Its
  description reads like the interaction Mainframe wants, but its definition
  object carries no `load:` key, so its execution path was not traced and its
  file-level mechanics are unverified. This is the one open question that could
  change the product shape, not just the implementation.
- **Whether `/branch` is reachable headlessly.** `CLEAR.md` documents
  `thinClientDispatch` as the mechanism that exposes `/clear` to stream-json
  clients. `/branch`'s 2.1.219 definition carries no `thinClientDispatch` key,
  which suggests no — but that was inferred from the definition object, not
  traced through the dispatcher, and it does not matter given `--fork-session`
  works.
- **`--fork-session` with `--continue` and no `--session-id`** was not exercised
  live. The code path is shared with `--resume` (`cli/print.ts:4946-4956` in the
  leak) so it should behave identically, minting a random id.
- **Forking a *running* session.** Every experiment forked an idle session. Two
  processes with the same source transcript — one appending, one reading — is
  plausible but unverified, and it is exactly the case Mainframe's UI will
  invite. Worth a live test before shipping.

## Reproducing the binary citations

`grep` chokes on the 256 MB bundle; extract byte windows around a literal
instead. Every anchor quoted above resolves in 2.1.219:

```bash
python3 - <<'EOF'
f = "/Users/doruchiulan/.local/share/claude/versions/2.1.219"
d = open(f, 'rb').read().decode('utf-8', 'replace')
for needle in [
    'name:"branch",description:',                  # /branch definition
    'createFork:()=>sXd',                          # /branch module exports
    'forkedFrom:{sessionId:o,messageUuid:A.uuid}', # /branch entry stamping
    'name:"fork",description:',                    # both /fork variants
    'BH()&&!Yt(',                                  # command registry gate
    'function BH(',                                # BH = !Yer
    'function uXi(',                               # agent-view gate resolution
    'Error: Session ID ${jt} is already in use.',  # --session-id validation
    'Error: --resume-session-at requires --resume',# --resume-session-at guard
    ' (Branch)`;',                                 # getUniqueForkName / title rule
    'e.launch.fork?',                              # background-session argv
    'forkSession: invalid sessionId',              # SDK forkSession validation
    'forkedFrom:{sessionId:t,messageUuid:f.uuid}', # SDK forkSession stamping
]:
    i = d.find(needle)
    print(f"--- {needle} -> {i} ---\n{d[max(0, i - 200):i + 700]}\n")
EOF
```

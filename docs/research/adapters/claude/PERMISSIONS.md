# Claude CLI — Permission Rule Evaluation

How the Claude CLI decides allow/deny/ask for a tool call: where rules come
from, how they merge, the exact precedence ladder, and — the part Mainframe
cares about — when a decision produces a `can_use_tool` control_request and
what a valid reply looks like.

Sources: TypeScript source (`claude-code/src/`, 2026-03-31 leak) —
`types/permissions.ts`, `utils/permissions/{permissions,permissionRuleParser,
permissionsLoader,permissionSetup,shellRuleMatching,filesystem,
PermissionUpdate,PermissionUpdateSchema,PermissionPromptToolResultSchema}.ts`,
`tools/BashTool/bashPermissions.ts`, `cli/{print,structuredIO}.ts`,
`services/tools/{toolExecution,toolHooks}.ts` — reconciled against installed
binary **v2.1.220** (compiled; binary-side claims come from `strings` on the
minified bundle and are marked). Two binary drifts were established: the
localSettings root moved to the canonical git repo root, and `auto` became an
external permission mode. See [Drift](#drift-leak--21220).

## TL;DR

- **Only `ask` outcomes ever reach Mainframe.** Every allow and every deny is
  finalized in-process (`structuredIO.ts:554-559`); a `can_use_tool`
  control_request means the CLI already decided "ask" and Mainframe's only job
  is to resolve it.
- Precedence is **by behavior, not source**: deny > ask > allow. Source order
  only breaks ties within a behavior.
- Rules are strings — `Tool` or `Tool(content)` with `\(` `\)` escaping.
  `Bash()` ≡ `Bash(*)` ≡ `Bash`. `Edit(...)` rules govern Write and
  NotebookEdit too; there is no `Write(...)` matching.
- "Always allow" for Bash persists to `.claude/settings.local.json`; in
  2.1.220 that file lives at the **canonical git repo root**, not the cwd
  (binary-verified — a worktree session writes to the main repo's file).
- Allow replies must include `updatedInput` (send `{}` to reuse the original
  input). Malformed `updatedPermissions` are dropped, not fatal.
- Handle the `SandboxNetworkAccess` pseudo-tool, and expect a
  `bypassPermissions` session to be silently demotable mid-run.

## Rule Grammar

`permissionRuleValueFromString` (`utils/permissions/permissionRuleParser.ts:93`)
parses every rule string, wherever it appears (settings JSON,
`--allowedTools`, `updatedPermissions`):

```
rule    := ToolName | ToolName(content)
content := chars with "(" ")" escaped as "\(" "\)" and "\" as "\\"
```

- No unescaped `(`, unmatched parens, trailing garbage, or empty tool name →
  the whole string is treated as a bare tool name.
- Content `""` or `"*"` collapses to a tool-wide rule (`Bash()` ≡ `Bash(*)` ≡
  `Bash`), parser lines 126-128.
- Legacy names normalize on every parse (`permissionRuleParser.ts:21-33`):
  `Task`→Agent, `KillShell`→TaskStop, `AgentOutputTool`/`BashOutputTool`→
  TaskOutput. Persist/delete roundtrip-normalize both sides so a stored
  `KillShell` rule matches a canonical removal.
- Tool-wide rules also do MCP server matching (`permissions.ts:238-268`):
  `mcp__server` and `mcp__server__*` match every tool on that server;
  `mcp__server__tool` matches one. MCP rules never carry content.

### Bash content rules

`shellRuleMatching.ts:159` parses Bash rule content into three kinds, checked
in this order:

| Kind | Syntax | Semantics |
|------|--------|-----------|
| prefix | `Bash(git:*)` | `cmd === "git"` or `cmd.startsWith("git ")` — word-boundary, so `gitfoo` does not match |
| wildcard | `Bash(git * --force)` | glob→anchored regex, dotAll (spans heredoc newlines); `Bash(git *)` also matches bare `git` |
| exact | `Bash(npm test)` | string equality after normalization |

`:*` always wins over wildcard detection; `\*` is a literal star.

**Compound-command asymmetry** (`bashPermissions.ts:861-967`) — the most
surprising rule in the system: prefix/wildcard **allow** rules never match a
compound command (`a && b`, `a | b`, `a; b`), but **deny** and **ask** rules
do (with aggressive env-var stripping first). `Bash(git:*)` on allow will not
blanket-approve `git status && rm -rf /`; `Bash(rm:*)` on deny will catch it.
Compound commands are instead split (`splitCommand_DEPRECATED`) and each
sub-command evaluated; any deny → deny, any ask → ask, all allow → allow
(`bashPermissions.ts:2144-2385`).

### File-path rules

File rules use **gitignore syntax** (the `ignore` package,
`filesystem.ts:989`) with a per-rule root (`filesystem.ts:853-912`):

| Pattern | Root |
|---------|------|
| `//abs/path/**` | filesystem root — the absolute-path form |
| `~/path` | home directory |
| `/path` (single slash) | directory of the settings file that declared the rule (cwd for `session`/`cliArg`/`command`) |
| `src/**`, `./src/**` | rootless — matches anywhere |

All editing tools (Edit, Write, NotebookEdit) resolve rules under the Edit
tool name; all read tools under Read (`filesystem.ts:919-933`). A trailing
`/**` also matches the directory itself.

## Rule Sources and Settings Files

`PermissionRuleSource` (`types/permissions.ts`): the five setting sources plus
`cliArg`, `command`, `session`.

| Source | Origin | Persistable |
|--------|--------|-------------|
| `userSettings` | `~/.claude/settings.json` | yes |
| `projectSettings` | `<cwd>/.claude/settings.json` | yes |
| `localSettings` | `<repo-root>/.claude/settings.local.json` (2.1.220; leak: cwd) | yes |
| `flagSettings` | `--settings <file>` | no |
| `policySettings` | managed-settings.json / MDM / remote policy | no |
| `cliArg` | `--allowedTools` / `--disallowedTools` / `--add-dir` | no |
| `command` | slash-command frontmatter | no |
| `session` | in-memory: `updatedPermissions`, dialogs, hooks | in-memory only |

Rules come from `permissions.{allow,deny,ask}` string arrays in each settings
file (`permissionsLoader.ts:91-114`). Load order is `SETTING_SOURCES`
(`utils/settings/constants.ts`): user → project → local → flag → policy;
"later overrides earlier" applies to scalar settings — for permission rules
all sources contribute and behavior precedence decides. `--setting-sources`
can drop user/project/local, but `flagSettings` and `policySettings` always
load. Enterprise lockdown: `policySettings.allowManagedPermissionRulesOnly`
makes policy rules the only rules, blocks persisting new ones, and hides
"always allow" affordances (`permissionsLoader.ts:31-44,120-124,240`).

CLI flags land as rules (`permissionSetup.ts:872-1014`): `--allowedTools` →
allow rules with source `cliArg`, `--disallowedTools` → deny rules,
`--permission-mode` → the context mode, `--add-dir` → additional working
directories, `--dangerously-skip-permissions` →
`isBypassPermissionsModeAvailable` (gated off by
`permissions.disableBypassPermissionsMode` and a remote killswitch).

### Where "always allow" writes (binary-verified 2.1.220)

Bash/shell suggestion helpers hard-code `destination: 'localSettings'`
(`shellRuleMatching.ts:203-228`, `bashPermissions.ts:2473-2537`); file-read
and directory suggestions default to `session` (in-memory only)
(`filesystem.ts:1414-1473`).

In the leak, every project-scoped settings file resolves from
`getOriginalCwd()` (`utils/settings/settings.ts:239-253`). **In 2.1.220 the
localSettings root moved to the canonical git repo root.** The minified
resolver (recovered via `strings`):

```js
case "userSettings":    return resolve(userConfigDir)
case "policySettings":
case "projectSettings": return resolve(ctx.cwd)          // still cwd
case "localSettings":   return Jqe(ctx.cwd, ctx.canonicalGitRoot)  // repo root
case "flagSettings":    return dirname(resolve(ctx.flagPath))
```

`Jqe` falls back to the cwd when there is no git root, when the resolved root
equals the cwd, and when a directory-ownership check fails (platforms without
uid semantics log "not canonicalizing the consent store"). Consequences, all
visible in binary strings:

- A session in a **git worktree** (or any subdirectory) reads and writes the
  *main repo root's* `.claude/settings.local.json`. Worktree creation
  deliberately skips copying the file: "it resolves localSettings to the
  canonical repo root, so a copy would become a stale, revocation-resurrecting
  legacy overlay".
- A legacy `<cwd>/.claude/settings.local.json` is still **read and merged**
  underneath the canonical file (canonical wins), and a revocation pass edits
  the legacy file too ("Failed to revoke from legacy settings.local.json").
- `projectSettings` (`settings.json`) did **not** move — it is still
  cwd-relative.

## The Decision Pipeline

For one tool call: PreToolUse hooks run first (`toolExecution.ts:800`), then
`resolveHookPermissionDecision` → `canUseTool` → `hasPermissionsToUseTool` →
`hasPermissionsToUseToolInner` (`permissions.ts:1158-1310`):

| Step | Check | Outcome |
|------|-------|---------|
| 1a | whole-tool deny rule | deny |
| 1b | whole-tool ask rule (sandboxed Bash may fall through to auto-allow) | ask |
| 1c | `tool.checkPermissions(input)` — Bash AST analysis, file-path checks, MCP | allow/deny/ask/passthrough |
| 1d | tool returned deny | deny |
| 1e | `tool.requiresUserInteraction()` and result is ask | ask |
| 1f | content-specific ask rule (e.g. `Bash(npm publish:*)` on ask) | ask — **survives bypassPermissions** |
| 1g | safetyCheck ask (writes to `.git/`, `.claude/`, `.vscode/`, shell configs) | ask — **survives bypassPermissions** |
| 2a | mode is `bypassPermissions` (or `plan` + bypass available) | allow |
| 2b | whole-tool allow rule | allow |
| 3 | still passthrough | **ask** |

The `hasPermissionsToUseTool` wrapper (`permissions.ts:473-952`) then:
converts ask→**deny** when mode is `dontAsk` (508-517); auto-denies for
subagents flagged `shouldAvoidPermissionPrompts` (async/forked agents only,
never the top-level stdio session).

Hook interaction (`toolHooks.ts:332-431`): a PreToolUse hook decision of
`deny` is final and never reaches `canUseTool`; `allow` still runs the
rule-only check (`checkRuleBasedPermissions`, `permissions.ts:1071`) so a deny
rule overrides the hook and an ask rule still forces the prompt; `ask` is
passed as `forceDecision`, which **skips `hasPermissionsToUseTool` entirely**
(`structuredIO.ts:545`) and goes straight to the prompt channel.

Repeated denials are budgeted: `{maxConsecutive: 3, maxTotal: 20}`
(`denialTracking.ts:12-15`; values confirmed verbatim in the 2.1.220 binary).
On exceed in headless mode the turn **aborts** (`permissions.ts:984-1023`)
rather than degrading to a prompt.

## Permission Modes

| Mode | Effect |
|------|--------|
| `default` | Full pipeline; residual → ask |
| `acceptEdits` | Auto-approves edits inside working directories + a fixed Bash list (`mkdir touch rm rmdir mv cp sed`, per sub-command; `modeValidation.ts:7-50`). Not MCP, not general Bash |
| `plan` | Enforced by prompt, not the permission engine; only engine effect is the step-2a bypass when `isBypassPermissionsModeAvailable` |
| `bypassPermissions` | Step-2a allow. Still stopped by: deny rules, tool denies, content-specific ask rules (1f), safetyCheck asks (1g) |
| `dontAsk` | Every ask becomes a deny before the protocol — **no `can_use_tool` is ever emitted** |
| `auto` | Leak: internal-only (ant `TRANSCRIPT_CLASSIFIER` builds). **2.1.220: present in `EXTERNAL_PERMISSION_MODES`** (binary: `["acceptEdits","auto","bypassPermissions","default","dontAsk","plan"]`), so `--permission-mode auto` and `setMode: auto` validate. **Classifier confirmed live on 2.1.224** (headless `-p` probe, 2026-08-14, one turn per mode): a file write was allowed with no prompt (vs. refused under `default`), a network `curl` was allowed with no prompt (vs. refused under `acceptEdits`), and `rm -rf <file>` ran with no prompt. Mainframe requires **CLI ≥ 2.1.220**, the version where `auto` entered `EXTERNAL_PERMISSION_MODES`, and now exposes the mode through the `autoMode` adapter capability |

CLI 2.1.224 renamed the interactive mode to `manual` in `--permission-mode --help` output, but
`default` still passes argument validation (`claude --permission-mode default -p ""` fails only
later, on the missing prompt) — Mainframe's existing spawn path is unaffected by the rename.

The bypass killswitch (`bypassPermissionsKillswitch.ts`) can demote a running
`bypassPermissions` session via a remote gate — a long-lived Mainframe session
started with bypass can start emitting `can_use_tool` requests mid-run.

## The Headless Contract (stream-json)

`getCanUseToolFn` (`cli/print.ts:4267-4293`) picks the ask handler:

- `--permission-prompt-tool stdio` → `structuredIO.createCanUseTool`
  (`structuredIO.ts:533`): allow/deny short-circuit in-process; ask emits a
  `control_request`. When `--sdk-url` is used this is forced on.
- **No flag** → the raw decision is returned; any non-allow becomes an
  `is_error: true` `tool_result` carrying the decision's message
  (`toolExecution.ts:995-1037`) — asks silently fail as errors fed to the
  model, and land in the result event's `permission_denials`.
- Any other value → an MCP tool by that name is invoked as the prompt.

Request shape (`entrypoints/sdk/controlSchemas.ts:107-122`):

```jsonc
{ "type": "control_request", "request_id": "…",
  "request": { "subtype": "can_use_tool",
    "tool_name": "Bash", "input": { … },
    "permission_suggestions": [ /* PermissionUpdate[] */ ],
    "blocked_path": "…",        // optional
    "decision_reason": "…",     // optional, sanitized: rule/mode reasons stripped
    "tool_use_id": "toolu_…", "agent_id": "…" } }
```

PermissionRequest hooks **race** the client prompt
(`structuredIO.ts:577-638`); if a hook decides first the request is cancelled
via `control_cancel_request`. Mainframe removes the named request from the
chat's pending queue and never sends an answer for it. Errors synthesize a
deny.

Response (`PermissionPromptToolResultSchema.ts`):

| Field | allow | deny |
|-------|-------|------|
| `behavior` | `"allow"` | `"deny"` |
| `updatedInput` | **required** object; `{}` means "use original input" | — |
| `message` | — | **required** string |
| `interrupt` | — | optional; true aborts the whole turn |
| `updatedPermissions` | optional `PermissionUpdate[]` | — |
| `decisionClassification` | optional `user_temporary\|user_permanent\|user_reject` | same |
| `toolUseID` | optional string — **send it** | same |

**Send `toolUseID`; it is the CLI's duplicate-reply guard.** Present on both
the allow and deny branches
(`PermissionPromptToolResultSchema.ts:60,70` — note the `ID` casing, which
differs from the request's `tool_use_id`). It is not used for correlation
(that is the envelope's `request_id`); it feeds a replay defence in
`structuredIO.ts:378-393`. The CLI keeps a bounded `resolvedToolUseIds` set
(`:155,178-183`) and drops any `control_response` whose `toolUseID` is already
resolved, because — per the source comment — late duplicates "would push
duplicate assistant messages into the conversation, causing API 400 errors."

Mainframe already sends it on every reply (`session.rs:959`), which is correct
and worth preserving: omitting it silently forfeits the protection rather than
erroring. Relevant to the known "reply to a restored permission after CLI
death" gap, where a reply can plausibly arrive twice.

Robustness: malformed `updatedPermissions` and unknown
`decisionClassification` values are logged and **dropped** without rejecting
the decision (`.catch()` in the schema). Valid updates are applied to the live
context and persisted when the destination supports it
(`permissionPromptToolResultToPermissionDecision`, lines 95-106).

`PermissionUpdate` union (`PermissionUpdateSchema.ts:42-78`): `addRules`,
`replaceRules`, `removeRules` (`{rules: [{toolName, ruleContent?}], behavior,
destination}`), `setMode` (`{mode, destination}`), `addDirectories`,
`removeDirectories`. Destinations `userSettings`/`projectSettings`/
`localSettings` persist to disk; `session` and `cliArg` are in-memory. Echoing
`permission_suggestions` back verbatim mirrors the CLI's own "don't ask again"
behavior — note Bash suggestions arrive with `destination: 'localSettings'`
(disk, repo root) while file/dir suggestions arrive with `session`; Mainframe
forwards each suggestion's declared destination verbatim, so an ephemeral
grant is whatever the CLI itself scoped as `session`.

> **Fixed in #283.** Mainframe's `permission_updates.rs::keep_mode_changes_session_scoped`
> forwards each update's declared destination as-is, with one added invariant: a
> `setMode` update is always forwarded `session`-scoped, so a permission-mode
> change is never persisted as the project default. See finding 7 in the
> [research doc](../../research/2026-07-25-todo-241-claude-cli-reverse-engineer.md)
> for the mismatch this closed.

**`SandboxNetworkAccess`**: sandboxed Bash emits a synthetic `can_use_tool`
with `tool_name: "SandboxNetworkAccess"` mid-execution
(`structuredIO.ts:731-753`; name present ×3 in the 2.1.220 binary) — a
pseudo-tool with no tool behind it. Replying deny does not fail the Bash call;
it constrains network access.

## Drift (leak → 2.1.220)

| Area | Leak (2026-03-31) | 2.1.220 binary |
|------|-------------------|----------------|
| localSettings root | `resolve(getOriginalCwd())` | canonical git repo root, ownership-checked, cwd fallback; legacy cwd file read-merged + revoked-in-tandem |
| `EXTERNAL_PERMISSION_MODES` | 5 modes, `auto` internal | 6 modes — `auto` external; internal == external |
| Rule sources | 8 (`…`, `cliArg`, `command`, `session`) | +`toolsNarrowing` ("CLI tool narrowing"), +`mcpServerPolicy` ("MCP server policy") in source-label maps |
| Bash classifier stub message | "This feature is disabled" | string absent — stub either reworded or replaced; classifier activation in public builds **unverified** |

## What Mainframe's Adapter Should Rely On

1. A `can_use_tool` is always a residual **ask** — never second-guess it
   against your own rule model, and never expect notification of in-process
   allows/denies (they only surface in the result event's
   `permission_denials`).
2. Always send `updatedInput` on allow; `{}` reuses the original input.
3. Build `updatedPermissions` from `{toolName, ruleContent}` objects, not
   hand-escaped strings.
4. Persisted "always allow" rules land in the **main repo root's**
   `.claude/settings.local.json` — for Mainframe's worktree-isolated chats
   this means grants escape the worktree and apply repo-wide.
5. `Edit(...)` covers Write/NotebookEdit; `Read(...)` covers all read tools.
   Absolute-path rules are `//abs/path/**`.
6. Prefix allow rules never match compound commands; deny/ask rules do.
7. Handle `SandboxNetworkAccess`, mid-run bypass demotion, and the denial
   budget (3 consecutive / 20 total → turn aborts in headless mode).
8. `dontAsk` mode means zero permission traffic — asks become denies
   in-process.

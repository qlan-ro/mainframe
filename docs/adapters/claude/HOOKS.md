# Claude CLI — Hooks System

How the Claude CLI's hooks work: the hook events, the four hook types, the
execution/response protocol, and — the part Mainframe cares about — exactly
what a headless (stream-json) client sees and can control.

Sources: TypeScript source (`claude-code/src/`, 2026-03-31 leak) —
`utils/hooks.ts`, `schemas/hooks.ts`, `types/hooks.ts`,
`entrypoints/sdk/coreTypes.ts`, `entrypoints/sdk/coreSchemas.ts`,
`cli/print.ts`, `main.tsx` — reconciled against installed binary **v2.1.220**
via `strings` over the Mach-O, which for this Bun-compiled binary yields
readable minified JS. **Drift was established: 2.1.220 has 31 hook events to
the leak's 27** — see [Drift](#drift-leak--v21220). Claims sourced to the
binary are marked as such.

## TL;DR

- **27 hook events in the leak, 31 in 2.1.220** (`HOOK_EVENTS`,
  `entrypoints/sdk/coreTypes.ts:25-52` vs. the binary's own `HOOK_EVENTS`
  array). In stream-json mode the CLI emits lifecycle events for **only
  SessionStart and Setup** unless `--include-hook-events` (or
  `CLAUDE_CODE_REMOTE`) is set.
- Hook lifecycle events arrive as `system` messages with subtypes
  `hook_started` / `hook_progress` / `hook_response` — **only** when
  `--output-format stream-json --verbose`, which Mainframe already passes.
  Mainframe's Rust adapter currently drops these subtypes
  (`events.rs:90-131`) — flagged as an adapter gap, not fixed here.
- In non-interactive/SDK mode hooks **always run regardless of workspace
  trust**: `shouldSkipHookDueToTrust()` returns false when
  `getIsNonInteractiveSession()` — "trust is implicit". Mainframe-spawned
  sessions therefore execute the user's configured hooks unconditionally.
- Exit code 2 from a command hook = blocking feedback (stderr fed back to the
  model). Exit 0 with JSON stdout = structured response. `{"async":true}` as
  the first stdout line detaches the hook.
- SDK clients can register **callback hooks**: the CLI sends a
  `control_request` with subtype `hook_callback` and waits for the client's
  `control_response`. Mainframe does not use this today (its catch-all drops
  it).

## The Hook Events

Source: `entrypoints/sdk/coreTypes.ts:25-52` (the leak's 27). Input schemas:
`entrypoints/sdk/coreSchemas.ts:350-790`. The four events 2.1.220 adds are
listed separately under [Drift](#drift-leak--v21220).

Every hook input extends `BaseHookInput` = `{session_id, transcript_path, cwd,
permission_mode?, agent_id?, agent_type?}`. **`agent_id` presence (not
`agent_type`) distinguishes a subagent hook from the main thread.**

| Event | Fires | Notable input fields |
|-------|-------|----------------------|
| PreToolUse | Before each tool call | `tool_name`, `tool_input`, `tool_use_id` |
| PostToolUse | After a successful tool call | + `tool_response` |
| PostToolUseFailure | After a failed tool call | + `error` |
| Notification | CLI notifications | `message`, `notification_type` |
| UserPromptSubmit | User prompt accepted | `prompt` |
| SessionStart | Session begins | `source: startup\|resume\|clear\|compact` |
| SessionEnd | Session ends | `reason: clear\|resume\|logout\|prompt_input_exit\|other\|bypass_permissions_disabled` |
| Stop / StopFailure | Main agent finishes / fails a turn | `stop_hook_active` |
| SubagentStart / SubagentStop | Subagent lifecycle | `agent_type`, matcher on agent type |
| PreCompact / PostCompact | Around compaction | `trigger: manual\|auto` |
| PermissionRequest | Before showing a permission prompt | tool + input; can decide allow/deny |
| PermissionDenied | After a denial | `error` |
| Setup | `--init` / `--maintenance` | `trigger: init\|maintenance` |
| TeammateIdle / TaskCreated / TaskCompleted | Swarm/task plumbing | |
| Elicitation / ElicitationResult | MCP elicitation | |
| ConfigChange | Settings file changed mid-session | `source: user_settings\|project_settings\|local_settings\|policy_settings\|skills` |
| WorktreeCreate / WorktreeRemove | Worktree lifecycle | `worktreePath` in response |
| InstructionsLoaded | CLAUDE.md/memory loaded | `load_reason: session_start\|nested_traversal\|path_glob_match\|include\|compact`; `memory_type: User\|Project\|Local\|Managed` |
| CwdChanged | cwd changed | new cwd |
| FileChanged | Watched file changed | `event: change\|add\|unlink`, `file_path` |

Matcher semantics (`getMatchingHooks`, `utils/hooks.ts`): the per-event
`matcher` string matches against an event-specific key — `tool_name`
(PreToolUse/PostToolUse…), `source` (SessionStart), `trigger`
(Setup/PreCompact), `notification_type`, `reason` (SessionEnd), `error`,
`agent_type` (Subagent*), `mcp_server_name`, `load_reason`, or
`basename(file_path)` (FileChanged). `matchesPattern()` supports exact, `*`,
pipe-lists (`A|B`), and regex.

## Hook Types and Configuration

Source: `schemas/hooks.ts`. Config shape (settings files, all scopes):

```json
{"hooks": {"<EventName>": [{"matcher": "...", "hooks": [<HookDef>...]}]}}
```

Four hook definition types:

| type | Runs | Extra fields |
|------|------|--------------|
| `command` | Shell command; input JSON on stdin | `if` (permission-rule-syntax gate, e.g. `Bash(git *)`), `shell`, `timeout` (s), `statusMessage`, `once`, `async`, `asyncRewake` |
| `prompt` | One-shot LLM prompt (`$ARGUMENTS` substitution) | `model` |
| `agent` | Subagent evaluates (default Haiku, 60 s) | |
| `http` | POST to URL | `headers`, `allowedEnvVars` |

Timeouts: tool hooks default `TOOL_HOOK_EXECUTION_TIMEOUT_MS = 10 min`;
SessionEnd hooks get only `1500 ms` by default (override
`CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS`) — long SessionEnd hooks are
silently cut short at process exit.

Environment given to command hooks: `CLAUDE_PROJECT_DIR` (**stable project
root — never the worktree**), `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`,
`CLAUDE_PLUGIN_OPTION_<KEY>`, `CLAUDE_ENV_FILE` (SessionStart / Setup /
CwdChanged / FileChanged, bash only — a file the hook can write `KEY=VAL`
lines into to mutate the session env), `CLAUDE_CODE_SHELL_PREFIX`.

stdin: the JSON input followed by a trailing `\n` (the newline is required —
gh-30509/CC-161; hooks that read-until-EOF are fine, line-readers need it).

## Execution Protocol (command hooks)

Source: `utils/hooks.ts`, `types/hooks.ts`.

| Outcome | Meaning |
|---------|---------|
| exit 0, plain stdout | Success; stdout may be shown/added as context depending on event |
| exit 0, JSON stdout | Parsed against `syncHookResponseSchema` (below) |
| **exit 2** | **Blocking**: stderr becomes feedback to the model (PreToolUse: tool call denied; Stop: turn continues; UserPromptSubmit: prompt blocked) |
| other exit | Non-blocking error, logged |
| `{"async":true}` first stdout line | Hook detaches; optional `asyncTimeout`; result delivered later (asyncRewake can re-trigger) |

Sync JSON response (`types/hooks.ts:50-166`): `continue`, `suppressOutput`,
`stopReason`, `decision: approve|block`, `reason`, `systemMessage`, and a
per-event `hookSpecificOutput` discriminated union — highlights:

- PreToolUse: `permissionDecision` (allow/deny/ask), `updatedInput`,
  `additionalContext`
- UserPromptSubmit / SessionStart / Setup / SubagentStart / PostToolUse:
  `additionalContext` (injected into the prompt); SessionStart also
  `initialUserMessage` and `watchPaths` (arms FileChanged)
- PermissionRequest: full `decision` object (allow with `updatedInput` /
  `updatedPermissions`, or deny with `interrupt`)
- PostToolUse: `updatedMCPToolOutput`

There is also a prompt-elicitation sub-protocol: a hook may print
`{prompt: <requestId>, message, options[]}` and receives
`{prompt_response, selected}` on stdin — interactive-only in practice.

## What a Headless Client Sees (Mainframe's contract)

Source: `cli/print.ts:628-671`, `entrypoints/sdk/coreSchemas.ts:1604-1645`,
`main.tsx:1231-1232`, `utils/hooks/hookEvents.ts`.

1. **Hooks run server-side in the CLI process.** Mainframe does not need to
   (and cannot) execute them; it only observes lifecycle events.
2. **Trust is bypassed:** `shouldSkipHookDueToTrust()` short-circuits to
   "execute" when `getIsNonInteractiveSession()` — the trust dialog gate
   applies only to interactive sessions. A Mainframe-spawned CLI runs the
   user's configured hooks unconditionally.
3. Lifecycle events are emitted only when `outputFormat === 'stream-json' &&
   verbose` (both true for Mainframe), as `system` messages:
   - `{type:'system', subtype:'hook_started', hook_id, hook_name, hook_event, uuid, session_id}`
   - `hook_progress` — adds `stdout`, `stderr`, `output`
   - `hook_response` — adds `output`, `stdout`, `stderr`, `exit_code?`,
     `outcome: success|error|cancelled`
   - Related: `{type:'system', subtype:'local_command_output', content}` for
     local slash-command stdout.
4. **Event gating:** `ALWAYS_EMITTED_HOOK_EVENTS = ['SessionStart','Setup']`.
   All other hook events emit lifecycle messages only with
   `--include-hook-events` (or env `CLAUDE_CODE_REMOTE`), which sets
   `setAllHookEventsEnabled(true)` (`main.tsx:1231-1232`). Mainframe does not
   pass the flag, so today it receives (and drops) only
   SessionStart/Setup hook events.
5. **HTTP hooks are silently skipped for SessionStart/Setup — in every mode,
   not just headless.** `utils/hooks.ts:1851-1863` filters on
   `hookEvent === 'SessionStart' || hookEvent === 'Setup'` with **no
   interactivity guard**; the headless deadlock (the sandbox ask callback
   blocks because the structured-input consumer hasn't started yet) is given
   in the comment as the *rationale* for the rule, not as a condition on it.
   So this is not a Mainframe-vs-terminal difference: a SessionStart http hook
   does not run in the interactive CLI either. Triage should not go looking for
   a Mainframe-specific cause.
6. **Callback hooks (SDK):** hooks can be registered by the SDK client at
   `initialize` time; the CLI then round-trips each firing through
   `control_request` subtype `hook_callback` (`{callback_id, input,
   tool_use_id?}`, `entrypoints/sdk/controlSchemas.ts:363-371`;
   `cli/structuredIO.ts` `createHookCallback`) and expects a
   `control_response` matching `hookJSONOutputSchema`. Errors resolve to `{}`
   (fail-open). This is the headless path to *implementing* hooks in
   Mainframe itself — currently unused; the adapter's control_request
   catch-all drops the subtype.

### Adapter findings (flagged, not fixed)

- Mainframe already receives `system/hook_started|hook_progress|hook_response`
  for SessionStart/Setup hooks and never surfaces them to the user. The Rust
  adapter's `handle_system_event` (`events.rs:90-131`) matches `init`,
  `compact_boundary`, `task_started`, `task_updated`, `task_notification`, and
  a `status` subtype whose payload equals `"compacting"`, then falls through to
  `_ => {}`. They are not discarded *silently* in the logging sense —
  `handle_event` (`events.rs:~390`) emits a `tracing::debug!` carrying type and
  subtype for every event — but nothing reaches the UI. Not a correctness bug
  (unknown events are meant to be skipped), yet hook failures during session
  start are invisible to Mainframe users today.
- SessionEnd hooks get 1.5 s. Mainframe kills the CLI process on stop; hooks
  that depend on SessionEnd may not complete. Interactive-only assumption:
  none — SessionEnd fires headlessly, it is just time-boxed.

## Drift (leak → v2.1.220)

The leaked `HOOK_EVENTS` (`entrypoints/sdk/coreTypes.ts:25-52`) has **27**
members. The 2.1.220 binary carries a **31**-member `HOOK_EVENTS` array, and a
matching 31-entry hook dispatch map. Both are recoverable from `strings`; the
array verbatim:

```js
["PreToolUse","PostToolUse","PostToolUseFailure","PostToolBatch","Notification",
 "UserPromptSubmit","UserPromptExpansion","SessionStart","SessionEnd","Stop",
 "StopFailure","SubagentStart","SubagentStop","PreCompact","PostCompact",
 "PermissionRequest","PermissionDenied","Setup","TeammateIdle","TaskCreated",
 "TaskCompleted","Elicitation","ElicitationResult","ConfigChange",
 "WorktreeCreate","WorktreeRemove","InstructionsLoaded","CwdChanged",
 "FileChanged","DirectoryAdded","MessageDisplay"]
```

The leak's 27 are a strict subset. The four additions, with the input fields
the binary's own `hook_event_name` constructors carry:

| Event (2.1.220 only) | Input fields (binary) | Apparent purpose |
|----------------------|-----------------------|------------------|
| `PostToolBatch` | `tool_calls` | Fires once per batch of parallel tool calls rather than per call. The binary also carries `executePostToolBatchHooks`, `"Execution stopped by PostToolBatch hook"`, and `"PostToolBatch hooks cancelled (control stream closed)"` — so it is blocking and cancellable |
| `UserPromptExpansion` | `expansion_type`, `command_name`, `command_args`, `command_source`, `prompt` | Fires when a slash command / skill expands into a prompt — after `UserPromptSubmit`, with the resolved command identity |
| `DirectoryAdded` | `directory`, `source` | `--add-dir` / `/add-dir` working-directory additions |
| `MessageDisplay` | `turn_id`, `message_id`, `index`, `final`, `delta` | Per-message render notification, including streaming deltas |

`ALWAYS_EMITTED_HOOK_EVENTS` is still `["SessionStart","Setup"]` in 2.1.220
(binary-verified) — the gating rule in the previous section is unchanged by
this drift.

Consequence for Mainframe: nothing breaks today (it drops all hook lifecycle
events), but any table of hook events pinned to the leak is already four short,
and `--include-hook-events` would surface 31 events, not 27.

## Headless Equivalents Summary

| Capability | Headless path |
|-----------|---------------|
| Run configured hooks | Automatic — same settings files as interactive; trust gate bypassed |
| Observe SessionStart/Setup hooks | Already streamed (stream-json + verbose) |
| Observe all hook lifecycles | Add `--include-hook-events` |
| Implement hooks in the host app | SDK callback hooks via `initialize` + `hook_callback` control round-trip |
| SessionStart env injection | `CLAUDE_ENV_FILE` from a command hook, or `additionalContext`/`initialUserMessage` JSON response |
| HTTP hooks at SessionStart/Setup | **No path in any mode** — skipped by design, interactive included |

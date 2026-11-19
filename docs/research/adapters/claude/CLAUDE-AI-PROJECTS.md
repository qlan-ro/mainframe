# claude.ai Projects in the Claude CLI

Research date: 2026-11-17. Installed CLI: 2.1.318. Evidence comes from strings in the darwin-arm64 binaries of 2.1.150 through 2.1.326 (inspected, never run), plus one live headless turn on the installed 2.1.318. **Verified** means a string in the binary or the live run shows it. **Inferred** means it is read from minified code or prose and was not exercised.

None of this is in the upstream `CHANGELOG.md`. A search for `send-to-project`, `Claude Project`, `attributionProject`, `CLAUDE_CODE_ATTRIBUTION_PROJECT` and `Projects tool` finds nothing. The only `project` command entries are `claude project purge`, later renamed `claude purge`. So changelog-watch could not have caught any of it.

The CLI has four separate pieces that mention claude.ai Projects:

| Piece | What it does | First version | Gate |
|---|---|---|---|
| `Projects` tool | Read and write the knowledge docs of the one claude.ai Project the session is bound to | 2.1.174 (2026-06-11) | `CLAUDE_PROJECT_UUID` set and policy `allow_projects_tool` |
| Usage attribution | Tag API requests with a Project for org usage reports | 2.1.304 (2026-10-19); `/project` command in 2.1.318 | claude.ai login, direct Anthropic connection; `/project` behind flag `tengu_gentle_cupcake` |
| `/send-to-project` | Hand the session's work to a Claude Project on claude.ai/code | 2.1.314 (2026-10-30) | User-typed only, terminal-oriented |
| Remote Control hint | `claude remote-control` help says Projects can send work to this folder | before 2.1.280 | Flag `tengu_bridge_rc_projects_hint`, default on |

## 1. The `Projects` tool

**Name and purpose (verified).** The tool name is the literal `"Projects"`. Its prompt opens: "Read and write the claude.ai Project attached to this session. A Project is a shared knowledge container on claude.ai — its docs persist across sessions and surfaces (chat, Cowork, Claude Code), so anything you write here is visible to the user and their team in claude.ai." It also says: "The session is bound to exactly one project (set by the harness when the session started). You never pass a project ID … if the user wants a different project, they restart the session."

**When it is offered (verified).** The tool's `isEnabled` is `mn("allow_projects_tool")&&Ne()!==void 0`, and `Ne()` returns `i.CLAUDE_PROJECT_UUID`. Nothing checks whether the session is interactive. The live check confirmed it. A stream-json session spawned as `CLAUDE-FLAG-01` describes (`-p --output-format stream-json --input-format stream-json --verbose`, `--permission-mode default`), with `CLAUDE_PROJECT_UUID=00000000-0000-4000-8000-000000000000`, listed `Projects` among the 76 tools in its `system/init` event. At startup the CLI fetched the Project and logged `project context fetch failed: Projects API: get project detail failed (HTTP 404) … The requested project was not found.` The turn itself succeeded. Without the variable the tool is not enabled (verified from `isEnabled`). Normal Mainframe chats never set the variable, so they never see the tool.

**Who sets `CLAUDE_PROJECT_UUID` (inferred).** A harness that starts Claude Code "in a claude.ai Project" sets it: the tool prompt says the binding is "set by the harness when the session started". The binary lists the variable beside `CLAUDE_COWORK_*` and `CLAUDE_RUNNER_*`, which points to claude.ai, Cowork and runner sessions. Any host that exports it gets the tool, Mainframe included.

**Methods and input (verified).** One schema dispatches on `method`. The choices are `project_info`, `project_read`, `project_search`, `project_write`, `project_delete`, `project_memory_list` and `project_memory_read`. The other fields are:

- `path`: a doc path. A new bare filename on write goes to `claude/<name>`.
- `content` or `local_path`: one of the two on write.
- `present_to_user`
- `if_version`: an optimistic-concurrency version for writes, offered only when `docVersionsOffered`.
- `query` and `n` (1–15, default 5): for `project_search`, which does RAG.
- `original`: on `project_read` of a PDF or docx, saves the original file instead of the extracted text. Flag `tengu_mossy_wirth`.

The output is a union discriminated by `method`. For example, `project_info` returns `name`, `description`, `instructions`, `docs[]`, `files[]`, `sync_sources[]` and `knowledge.{knowledge_size,max_knowledge_size}`.

**Permissions (inferred).** Read methods are classed as read-only. A write or delete is treated as needing approval when `k("tengu_serene_curry", …)` holds. In Mainframe such a call would arrive as an ordinary `can_use_tool` request (`CLAUDE-CTRL-01`).

**Context block (verified).** When the variable is set, the CLI fetches the Project at startup and injects a "project context" block into the user context. The log line "project context: policy verdict allows the Projects tool; user context will be rebuilt with the project block" shows this. Project memory files live under `/projects/<project uuid>/` in the session's memory store.

**Preconditions (verified).** These are the error strings, keyed by reason:

- `wrong_provider`: "Projects is only available with claude.ai authentication. It is not supported through Bedrock, Vertex, or other third-party providers."
- `essential_traffic_only`: "Projects is unavailable while nonessential network traffic is restricted (CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC is set)."
- `no_token`: covers a Console login.
- `custom_client`: a custom OAuth client "cannot be granted project scopes".

When needed, the CLI widens the claude.ai token on its own: "Upgraded your claude.ai login to include project access (user:projects:read, user:projects:write)." The policy key `allow_projects_tool` is `deniedUnder:["hipaa"]` with `onCacheMiss:"hold"`. CLIProxy chats (`CLAUDE-ENV-01`) would get `wrong_provider`.

## 2. Usage attribution: `attributionProject` and `/project`

**Setting keys (verified).** The user, project and local settings key is `attributionProject`: "The claude.ai Project this session names for your organization's usage reports: the Project's ID, starting with "claude_proj_" or "chan_", or the UUID of a "claude_proj_" Project." The org default is `attributionProjectPolicy`, which is "Only honored from managed settings". The environment override `CLAUDE_CODE_ATTRIBUTION_PROJECT` wins over both, and is recommended for untrusted folders such as CI. Settings in a project's `.claude/settings.json` count only once the folder is trusted.

**Transport (verified).** The resolved Project goes into the existing billing header, not a new one: `x-anthropic-billing-header: cc_version=…; cc_entrypoint=…; … cc_project=<id>; cc_project_src=<source>;`. Per the setting text it is "Sent only when Claude Code uses your claude.ai login, connects directly to the Anthropic API, is not in a cloud session, and CLAUDE_CODE_ATTRIBUTION_HEADER is not 0". The header code already had an `attributionProject` slot in 2.1.302. The setting and the environment variable arrived in 2.1.304.

**`/project` (verified).** It is defined as `{type:"local",name:"project",description:"Set the claude.ai Project for this session's usage reports",argumentHint:"[Project ID or claude.ai address] [--save] | clear [--save]",isEnabled:()=>wls()&&k("tengu_gentle_cupcake",!1),supportsNonInteractive:!0}`. It first appears in 2.1.318. It is off unless that flag turns it on, and `wls()` requires a subscriber login. `supportsNonInteractive` means a stream-json session could run it once the flag is on. `--save` writes `attributionProject` to a settings file. Without `--save`, the change lasts for the session only.

**Session notice (verified).** The CLI can show "This session names claude.ai Project <name> for usage reports (<origin>)", or a warning when the value is not a Project ID.

## 3. `/send-to-project`, `SendToProject`, `SendToProjectContext`

**What it is (verified).** It targets a different kind of Project: "A Claude Project is a cloud workspace on claude.ai/code: it has a coordinator and threads that do the work." The `SendToProject` tool description reads "Send this session's work to a Claude Project". It shows the user a drafted brief on the tool's confirmation pane. If they approve, it creates the project (or uses an existing one), optionally adds the folder's GitHub origin, saves the brief to project memory and posts it as the setup card. It also tells the project which Remote Control session the work came from. `SendToProjectContext` returns what the command read from the folder.

**Gate (verified strings, inferred effect).** The command sets `userInvocable:!0, disableModelInvocation:!0, disableBridgeInvocation:!0, terminalOriented:!0`. Its ownership check refuses with reasons such as `not_owner_remote_control` and `not_owner_not_local_stdin`, or when `submissionOrigin.kind` is not `human`. Mainframe types slash commands into stream-json stdin (`CLAUDE-IO-02`), and that likely fails the human/terminal check. Not tested.

## 4. Remote Control hint

**Verified.** When `tengu_bridge_rc_projects_hint` is on (the default), the `claude remote-control` help adds " Your projects on claude.ai can also ask Claude to work in this directory." The first-run prompt adds "or ask Claude to work in this folder from one of your projects on claude.ai." This is help text only, for the Remote Control bridge. Mainframe does not use the bridge.

## What it means for Mainframe

- **Nothing breaks today.** No consumed row changes. A chat gets the `Projects` tool only if `CLAUDE_PROJECT_UUID` is in the child's environment. The child inherits Mainframe's environment, so a user who exports it in their shell would see the tool appear (inferred).
- **Attribution already works without Mainframe doing anything** for anyone who sets `attributionProject` in user or project settings, because the spawned CLI reads those files. Mainframe would only add value with a per-project field that sets `CLAUDE_CODE_ATTRIBUTION_PROJECT` on the child. That is useful only for organization claude.ai logins.
- **The `Projects` tool is the real adoption candidate.** A per-Mainframe-project "linked claude.ai Project" field that sets `CLAUDE_PROJECT_UUID` on native chats would give agents RAG search and doc read/write over that Project's knowledge base. It would also put the project context block into the session. The tool would fall into the default tool category (`CLAUDE-PROBE-02` lists no `Projects` entry). Writes would raise ordinary permission gates.
- **`/send-to-project` and the Remote Control hint are not candidates.** The first is terminal-only by design. The second is help text.

## Recommendation

1. **Adopt the `Projects` tool as an opt-in per-project link. Size: medium.** That covers a project setting and env injection in `src/session_spawn.rs::build_spawn_command`, scoped to native, non-CLIProxy chats. It also needs a tool category entry and a light renderer for `project_*` results.
2. **Optionally, in the same change, add an attribution field that sets `CLAUDE_CODE_ATTRIBUTION_PROJECT`. Size: small.**

Before building, verify live against a real Project the user picks: that `project_info` and `project_search` return data, and how writes are gated.

# Tool Card Rendering Audit — Desktop vs Mobile

Issue: #60 — Unify desktop and mobile message rendering

## CLI Tools — Full Inventory

Source: `~/Projects/qlan/claude-code/src/tools/` (2026-03-31 leak), registry in `src/tools.ts`.

### Always-on tools (default preset)

| CLI Tool Name | Emitted Name | Notes |
|---|---|---|
| BashTool | `Bash` | |
| FileEditTool | `Edit` | |
| FileReadTool | `Read` | |
| FileWriteTool | `Write` | |
| GlobTool | `Glob` | omitted if `hasEmbeddedSearchTools()` |
| GrepTool | `Grep` | omitted if `hasEmbeddedSearchTools()` |
| AgentTool | `Agent` | legacy alias: `Task` |
| SkillTool | `Skill` | |
| AskUserQuestionTool | `AskUserQuestion` | |
| EnterPlanModeTool | `EnterPlanMode` | |
| ExitPlanModeV2Tool | `ExitPlanMode` | (v1 still exports same name) |
| TodoWriteTool | `TodoWrite` | |
| TaskOutputTool | `TaskOutput` | |
| TaskStopTool | `TaskStop` | |
| WebFetchTool | `WebFetch` | |
| WebSearchTool | `WebSearch` | |
| NotebookEditTool | `NotebookEdit` | |
| BriefTool | `SendUserMessage` | legacy alias: `Brief` |
| ListMcpResourcesTool | `ListMcpResourcesTool` | |
| ReadMcpResourceTool | `ReadMcpResourceTool` | |
| McpAuthTool | `mcp__<server>__authenticate` | dynamic per-server |
| MCPTool | `mcp__<server>__<tool>` | dynamic per MCP tool |

### Conditional / feature-flagged tools

| CLI Tool Name | Emitted Name | Gate |
|---|---|---|
| TaskCreateTool | `TaskCreate` | `isTodoV2Enabled()` |
| TaskUpdateTool | `TaskUpdate` | `isTodoV2Enabled()` |
| TaskListTool | `TaskList` | `isTodoV2Enabled()` |
| TaskGetTool | `TaskGet` | `isTodoV2Enabled()` |
| ToolSearchTool | `ToolSearch` | `isToolSearchEnabledOptimistic()` |
| EnterWorktreeTool | `EnterWorktree` | `isWorktreeModeEnabled()` |
| ExitWorktreeTool | `ExitWorktree` | `isWorktreeModeEnabled()` |
| LSPTool | `LSP` | `ENABLE_LSP_TOOL` env truthy |
| ConfigTool | `Config` | `USER_TYPE === 'ant'` |
| TungstenTool | `Tungsten` | `USER_TYPE === 'ant'` |
| REPLTool | `REPL` | `USER_TYPE === 'ant'` |
| PowerShellTool | `PowerShell` | `isPowerShellToolEnabled()` |
| TeamCreateTool | `TeamCreate` | `isAgentSwarmsEnabled()` |
| TeamDeleteTool | `TeamDelete` | `isAgentSwarmsEnabled()` |
| SendMessageTool | `SendMessage` | (lazy-loaded) |
| SleepTool | `Sleep` | `feature('PROACTIVE') \|\| feature('KAIROS')` |
| CronCreateTool | `CronCreate` | `feature('AGENT_TRIGGERS')` |
| CronDeleteTool | `CronDelete` | `feature('AGENT_TRIGGERS')` |
| CronListTool | `CronList` | `feature('AGENT_TRIGGERS')` |
| RemoteTriggerTool | `RemoteTrigger` | `feature('AGENT_TRIGGERS_REMOTE')` |
| ScheduleWakeupTool | `ScheduleWakeup` | added post-leak; present in v2.1.118; powers `/loop` dynamic mode |
| AdvisorTool | (server-side, no emitted name) | added post-leak; opus-4.6/4.7 + sonnet-4.6 advisor model; not user-callable |
| TeammateTool | `Teammate` (UI label) | added post-leak; agent-swarm peers; reads team config files |
| MonitorTool | `Monitor` | `feature('MONITOR_TOOL')` |
| SendUserFileTool | `SendUserFile` | `feature('KAIROS')` |
| PushNotificationTool | `PushNotification` | `feature('KAIROS') \|\| feature('KAIROS_PUSH_NOTIFICATION')` |
| SubscribePRTool | `SubscribePR` | `feature('KAIROS_GITHUB_WEBHOOKS')` |
| WebBrowserTool | `WebBrowser` | `feature('WEB_BROWSER_TOOL')` |
| SnipTool | `Snip` | `feature('HISTORY_SNIP')` |
| ListPeersTool | `ListPeers` | `feature('UDS_INBOX')` |
| WorkflowTool | `Workflow` | `feature('WORKFLOW_SCRIPTS')` |
| OverflowTestTool | `OverflowTest` | `feature('OVERFLOW_TEST_TOOL')` |
| CtxInspectTool | `CtxInspect` | `feature('CONTEXT_COLLAPSE')` |
| TerminalCaptureTool | `TerminalCapture` | `feature('TERMINAL_PANEL')` |
| VerifyPlanExecutionTool | `VerifyPlanExecution` | `CLAUDE_CODE_VERIFY_PLAN` env truthy |
| SuggestBackgroundPRTool | `SuggestBackgroundPR` | `USER_TYPE === 'ant'` |
| SyntheticOutputTool | `StructuredOutput` | injected by classifier, not user-callable |
| TestingPermissionTool | `TestingPermission` | `NODE_ENV === 'test'` |

### Removed since the leak

| Removed | Replaced by |
|---|---|
| `ExitPlanModeTool` (v1) | `ExitPlanModeV2Tool` (same emitted name `ExitPlanMode`) |
| `Brief` | `SendUserMessage` (BriefTool now emits new name; `Brief` is legacy alias) |
| `Task` | `Agent` (`Task` kept as legacy alias) |
| `KillShell` | `TaskStop` (`KillShell` kept as legacy alias; user-facing name "Stop Task") |
| `AgentOutputTool` / `BashOutputTool` | not separate tools — internal dispatch aliases for output retrieval |

### Web-harness-injected tools (NOT in CLI source)

These are NOT in the CLI binary. They appear in deferred-tool lists when
running inside the claude.ai web app, which injects integration tools above
the CLI/SDK protocol. Mainframe won't see these.

| Tool Name | Source | Purpose |
|---|---|---|
| `mcp__claude_ai_Gmail__*` | claude.ai web harness | Gmail integration |
| `mcp__claude_ai_Google_Calendar__*` | claude.ai web harness | Calendar integration |
| `mcp__claude_ai_Google_Drive__*` | claude.ai web harness | Drive integration |
| `mcp__claude_ai_Notion__*` | claude.ai web harness | Notion integration |
| `mcp__claude_ai_Slack__*` | claude.ai web harness | Slack integration |
| `mcp__claude_ai_lastminute_com__*` | claude.ai web harness | travel integration |

---

## Per-Tool Rendering Diagrams

### 1. BashCard

```
DESKTOP (current)                              MOBILE (current)

  Collapsed:                                     Always expanded, no collapse:
  ┌────────────────────────────────────────┐     ┌─ border-1 #43454a ─────────────┐
  │ ● Terminal(15)  npm run bui… [↗ Max2] │     │ Terminal(14)  npm run build  ● │
  │   Install project deps                │     │──── h-px #393b40 ──────────────│
  │   ╰subheader when collapsed only      │     │ PASS src/index.test.ts         │
  └────────────────────────────────────────┘     │ ✓ should work   ← max 8 lines │
  Expanded:                                      └────────────────────────────────┘
  ┌────────────────────────────────────────┐     No subheader. No collapse.
  │ ● Terminal(15)  npm run bui… [↙ Min2] │     No error border style.
  │──── border-t ──────────────────────────│
  │ $ npm run build --filter=@qlan...     │
  │──── border-t ──────────────────────────│
  │ PASS src/index.test.ts                │
  │ ✓ should work (23ms)                  │
  │ ╰max-h-[400px]                        │
  └────────────────────────────────────────┘
  StatusDot at start. Maximize2/Minimize2 toggle.
  No outer border. subheader only when collapsed.
```
Unified design: see U1 in "Unified Design Proposals" section.

### 2. EditFileCard

```
DESKTOP (CollapsibleToolCard, variant=primary, defaultOpen=true)

  ┌──────────────────────────────────────────────────────────────────────┐
  │ ● FileTypeIcon  src/foo.ts       +3    -1    [⧉ ExtLink] [↙ Min2]  │
  │ ╰StatusDot      ╰ClickableFilePath   ╰badges  ╰14px       ╰14px   │
  │ ╰pulse/grn/red  ╰mono,accent         ╰rounded-full                 │
  │                  ╰hover:underline     ╰bg-added/15 text-added-text  │
  │                  ╰click→open tab      ╰bg-removed/15 text-rem-text │
  │                                       ╰tabular-nums,status,mono    │
  │──────────────────────────────── border-t border-mf-divider ─────────│
  │ │  42  │      │ - │ old line content              max-h-[300px]    ││
  │ │  ╰w-8│      │╰w-5│ ╰removed-content             overflow-y-auto ││
  │ │  ╰r  │      │╰ctr│ ╰bg-removed/[8%]                             ││
  │ │  ╰rem│      │    │ ╰border-l-2 border-l-mf-chat-diff-removed    ││
  │ │  ╰op7│      │    │ ╰hover:bg-removed/[13%]                      ││
  │ │      │  43  │ + │ new line content                               ││
  │ │      │  ╰w-8│╰w-5│ ╰added-content                               ││
  │ │      │  ╰r  │╰ctr│ ╰bg-added/[8%]                               ││
  │ │      │  ╰add│    │ ╰border-l-2 border-l-mf-chat-diff-added      ││
  │ │      │  ╰op7│    │ ╰hover:bg-added/[13%]                        ││
  │ │  44  │  44  │   │ context line                                   ││
  │ │  ╰sec│  ╰sec│╰sp│ ╰sec text                                     ││
  │ │  ╰op3│  ╰op3│   │ ╰border-l-2 transparent                       ││
  │ │      │      │   │ ╰hover:bg-primary/5                            ││
  │ │                                                                  ││
  │ │──────────────────────────── border-t (if resultText) ────────    ││
  │ │ Result text...  ╰small,mono,sec,pre-wrap                         ││
  │ │ ╰error: bg-mf-chat-error-surface/20                             ││
  │ └──────────────────────────────────────────────────────────────────┘│
  │ DiffFromPatch used if structured hunks; DiffFallback otherwise      │
  └─────────────────────────────────────────────────────────────────────┘


MOBILE (custom EditCard, always visible, no collapse)

  ┌─ rounded-mf-card, bg-#11121466, border-1 #43454a ─────────────────┐
  │ Pencil(14)  src/foo.ts                           +3        -1      │
  │ ╰#a1a1aa    ╰mono,accent,13px,medium,numLines=1  ╰badges          │
  │                                                   ╰rounded-[10px]  │
  │                                                   ╰bg-#1ec55f20    │
  │                                                   ╰bg-#ef444520    │
  │─────────────────────────── h-px #393b40 ───────────────────────────│
  │ ← horizontal ScrollView                                            │
  │ ▎- old line                           ← max 20 lines per hunk     │
  │ ╰w-0.5 rounded-sm bar  ╰#ef444560 bar color                       │
  │ ╰bg-#ef444508                                                      │
  │ ╰text #ef444599                                                    │
  │ ╰mono 11px                                                        │
  │ ▎+ new line                                                        │
  │ ╰w-0.5 rounded-sm bar  ╰#1ec55f60 bar color                       │
  │ ╰bg-#1ec55f08                                                      │
  │ ╰text #1ec55f99                                                    │
  │ ▎  context                                                         │
  │ ╰transparent bar  ╰#a1a1aa50 text                                  │
  └────────────────────────────────────────────────────────────────────┘
  No collapse. No line numbers. No ExternalLink button. No click-to-open.
  Thinner left bar (w-0.5 vs border-l-2). No hover states.
```

### 3. WriteFileCard

```
DESKTOP (CollapsibleToolCard, variant=primary, defaultOpen=true)

  ┌──────────────────────────────────────────────────────────────────────┐
  │ ● FileTypeIcon  src/new.ts       +25          [⧉ ExtLink] [↙ Min2] │
  │ ╰StatusDot      ╰ClickableFilePath   ╰badge (added only)           │
  │                                       ╰removed badge if overwrite   │
  │──────────────────────────────── border-t ───────────────────────────│
  │ │  If hunks → DiffFromPatch (same as EditFileCard)                 ││
  │ │  If no hunks → line-by-line all-green:                           ││
  │ │       │   1 │ + │ import { x } from 'y';      max-h-[300px]     ││
  │ │  ╰w-8 │╰w-8│╰w-5│ ╰added-content                               ││
  │ │  empty │╰grn│╰ctr│ ╰bg-added/[8%]                               ││
  │ │       │╰op7│    │ ╰border-l-2 border-l-mf-chat-diff-added       ││
  │ │       │    │    │ ╰hover:bg-added/[13%]                          ││
  │ │       │   2 │ + │ const z = ...                                  ││
  │ │                                                                  ││
  │ │──────────────────────────── border-t (if resultText) ────────    ││
  │ │ Result text...                                                   ││
  │ └──────────────────────────────────────────────────────────────────┘│
  └─────────────────────────────────────────────────────────────────────┘


MOBILE (CompactToolPill — no file content shown)

  ┌─ bg-#11121466, rounded-mf-card, px-3 py-1.5 ──────────────────────┐
  │ FileText(14)  Write  src/new.ts                               ●   │
  │ ╰#a1a1aa66    ╰#a1a1aa99,xs,mono   ╰shortenPath(3)     ╰2x2 dot  │
  └────────────────────────────────────────────────────────────────────┘
```

### 4. ReadFileCard

```
DESKTOP (CollapsibleToolCard, variant=compact)

  Collapsed:
  ┌──────────────────────────────────────────────────────────────────────┐
  │ ◌  Eye(15)   src/foo.ts                                [↗ Maximize2]│
  │ ╰ErrorDot    ╰sec/40    ╰ClickableFilePath              ╰14px      │
  │ ╰err only                ╰mono,accent,hover:underline               │
  └─────────────────────────────────────────────────────────────────────┘

  Expanded:
  ┌──────────────────────────────────────────────────────────────────────┐
  │      Eye(15)   src/foo.ts                               [↙ Minimize2]│
  │      ┃ border-l border-mf-divider/50, ml-5                          │
  │      ┃   1 │ import { x } from 'y';           max-h-[300px]        │
  │      ┃   2 │ const z = ...                    overflow-y-auto      │
  │      ┃  ╰w-10,right-align,sec,opc-30   ╰sec,opc-60,pre-wrap       │
  │      ┃  ╰border-l-2 transparent per line                           │
  │      ┃  ╰hover:bg-primary/5                                        │
  │      ┃                                                              │
  │ Error state: pre, bg-mf-chat-error-surface/20, error-muted text    │
  └─────────────────────────────────────────────────────────────────────┘


MOBILE (CompactToolPill — no file content shown)

  ┌─ bg-#11121466, rounded-mf-card, px-3 py-1.5 ──────────────────────┐
  │ FileText(14)  Read  …rc/foo.ts                               ●    │
  │ ╰#a1a1aa66    ╰#a1a1aa99,xs,mono   ╰shortenPath(3)     ╰2x2 dot  │
  └────────────────────────────────────────────────────────────────────┘
```

### 5. SearchCard (Grep / Glob)

```
DESKTOP (CollapsibleToolCard, variant=compact)

  Collapsed:
  ┌──────────────────────────────────────────────────────────────────────┐
  │ ◌  Search(15)  Grep  "pattern"                         [↗ Maximize2]│
  │ ╰ErrorDot ╰sec/40    ╰sec/60  ╰mono,small,sec/60        ╰14px      │
  │                                ╰truncate,tooltip                     │
  └─────────────────────────────────────────────────────────────────────┘

  Expanded:
  ┌──────────────────────────────────────────────────────────────────────┐
  │      Search(15)  Grep  "pattern"                       [↙ Minimize2]│
  │      ┃ border-l border-mf-divider/50, ml-5                          │
  │      ┃ src/a.ts:42: matching line            max-h-[300px]          │
  │      ┃ src/b.ts:17: other match              mono,small             │
  │      ┃ ╰sec/60 or error-muted               overflow-y-auto        │
  │      ┃ ╰error: bg-mf-chat-error-surface/20                         │
  └─────────────────────────────────────────────────────────────────────┘


MOBILE (CompactToolPill — no results shown)

  ┌─ bg-#11121466, rounded-mf-card, px-3 py-1.5 ──────────────────────┐
  │ Search(14)  Grep  pattern                                    ●     │
  │ ╰#a1a1aa66  ╰#a1a1aa99,xs,mono                         ╰2x2 dot  │
  └────────────────────────────────────────────────────────────────────┘
```

### 6. TaskCard (Agent / Task)

```
DESKTOP (standalone div, no collapse)

  ┌──────────────────────────────────────────────────────────────────────┐
  │ Bot(14) general-purpose  opus  "Fix the login bug"   3 tools · 2k… ◌│
  │ ╰accent ╰accent,medium  ╰sec/50 ╰sec/70,truncate     ╰usage stats │
  │                          ╰mono   ╰tooltip:full desc    ╰sec/50,mono│
  │                                                                     │
  │ Pending (no result):                                                │
  │ Bot(14) general-purpose  opus  "Fix the login bug"              ●   │
  │                                                   ╰2x2,sec/40,pulse│
  │                                                                     │
  │ Usage format: "{toolUses} tool uses · {tokens} tokens · {duration}" │
  │   tokens: 1234→1.2k, 1234567→1.2M                                  │
  │   duration: human readable (s/m)                                    │
  │ Error: ErrorDot at end                                              │
  └─────────────────────────────────────────────────────────────────────┘


MOBILE (CompactToolPill — no model, no usage stats)

  ┌─ bg-#11121466, rounded-mf-card, px-3 py-1.5 ──────────────────────┐
  │ Bot(14)  general-purpose  Fix the login bug                  ●     │
  │ ╰#a1a1aa66  ╰#a1a1aa99,xs,mono                         ╰2x2 dot  │
  │              ╰"general-purpose" if subagent, else "Agent"          │
  └────────────────────────────────────────────────────────────────────┘
  No accent color on agent type. No model badge. No usage stats.
```

### 7. TaskGroupCard

```
DESKTOP (custom collapsible div, not CollapsibleToolCard)

  Collapsed:
  ┌──────────────────────────────────────────────────────────────────────┐
  │ Bot(14) general-purpose opus "Fix login" Read 3·Searched 1  ◌ [↗]  │
  │ ╰accent ╰accent,medium ╰sec ╰sec/70     ╰summary,sec/50    ╰Max2 │
  │                         ╰mono ╰truncate   ╰mono              ╰14px│
  │ button: w-full, py-0.5, hover:bg-mf-hover/20                       │
  └─────────────────────────────────────────────────────────────────────┘

  Expanded:
  ┌──────────────────────────────────────────────────────────────────────┐
  │ Bot(14) general-purpose opus "Fix login" Read 3·Searched 1  ◌ [↙]  │
  │  ├─ ● Eye(15)  src/auth.ts              ← ReadFileCard (compact)   │
  │  ├─ ● Search(15) Grep "password"        ← SearchCard (compact)     │
  │  ├─ ● FileTypeIcon src/auth.ts +5 -2    ← EditFileCard (primary)   │
  │  └─ Done. Fixed auth validation...      ← result text              │
  │     ╰pl-6,small,sec,pre-wrap,select-text                           │
  │     ╰stripped of <usage> tags and agentId hints                     │
  │ Children rendered via renderToolCard() — full nested cards          │
  │ Summary: "Read N file(s)" · "Searched N pattern(s)" etc.           │
  └─────────────────────────────────────────────────────────────────────┘


MOBILE (inline in AssistantMessage ContentBlock switch)

  ┌──────────────────────────────────────────────────────────────────────┐
  │ Bot(14) block.agentType   ← BUG: field doesn't exist on type       │
  │ ╰#f97312 ╰xs,#a1a1aa      ╰ should be block.agentId                │
  │                                                                     │
  │ block.description          ← BUG: field doesn't exist on type      │
  │ ╰xs,#a1a1aa80                                                      │
  │                                                                     │
  │ Children rendered inline via recursive ContentBlock calls           │
  │ No collapse. No summary. No usage/result text.                      │
  └─────────────────────────────────────────────────────────────────────┘
```

### 8. TaskProgressCard

```
DESKTOP (standalone list, no collapse)

  ┌──────────────────────────────────────────────────────────────────────┐
  │ ☐ Pending task name                                                 │
  │ ╰3.5x3.5 rounded-sm, border sec/30       ╰body,sec                 │
  │                                                                     │
  │ ■ In-progress task name                                             │
  │ ╰3.5x3.5 rounded-sm, bg-accent,          ╰body,primary             │
  │  border-accent                                                      │
  │                                                                     │
  │ ☑ Completed task name                                               │
  │ ╰3.5x3.5 rounded-sm, bg-success/20,      ╰body,sec/50,            │
  │  border-success/50, Check(12) inside       line-through             │
  │                                                                     │
  │ Container: space-y-0.5 py-0.5                                       │
  │ Deleted tasks filtered out, returns null if empty                    │
  └─────────────────────────────────────────────────────────────────────┘


MOBILE — NO HANDLER

  Falls to default CompactToolPill or not rendered (virtual type
  _TaskProgress is created by core pipeline, mobile may not encounter it
  if it doesn't use the same tool-grouping pipeline).
```

### 9. ToolGroupCard

```
DESKTOP (CollapsibleToolCard, variant=compact)

  Collapsed:
  ┌──────────────────────────────────────────────────────────────────────┐
  │ ◌  Layers(15)  Read 3 files · Searched 2 patterns      [↗ Maximize2]│
  │ ╰ErrorDot(agg) ╰sec/40     ╰body,sec/60                 ╰14px      │
  │ ╰red if any                                                         │
  │  child err                                                           │
  └─────────────────────────────────────────────────────────────────────┘

  Expanded:
  ┌──────────────────────────────────────────────────────────────────────┐
  │    Layers(15)  Read 3 files · Searched 2 patterns       [↙ Minimize2]│
  │    ┃ ml-5, border-l border-mf-divider/50                             │
  │    ┃ Eye(15)    src/a.ts                              ◌             │
  │    ┃ Eye(15)    src/b.ts                              ◌             │
  │    ┃ Eye(15)    src/c.ts                                            │
  │    ┃ Search(15) "pattern1"                            ◌             │
  │    ┃ Search(15) "pattern2"                            ◌             │
  │    ┃ ╰sec/40    ╰mono,sec/60,truncate,tooltip          ╰ErrorDot    │
  │    ┃ per item: py-0.5, px-3, hover:bg-mf-hover/20                   │
  └─────────────────────────────────────────────────────────────────────┘


MOBILE (renders each call separately via recursive ContentBlock)

  Each child tool_call rendered individually via ToolCardRouter.
  No grouping header, no summary, no Layers icon.
```

### 10. SlashCommandCard (Skill tool_use) — DORMANT

```
DESKTOP (standalone div, no collapse) — registered in tool-ui-registry.tsx
        and render-tool-card.tsx for toolName === 'Skill'

  ┌──────────────────────────────────────────────────────────────────────┐
  │ Zap(14)  /brainstorming  some-args-here                             │
  │ ╰accent  ╰mono,body,accent  ╰mono,small,sec/60,truncate,tooltip    │
  │ Container: flex, gap-1.5, py-0.5                                    │
  └─────────────────────────────────────────────────────────────────────┘

MOBILE — CompactToolPill fallback (Skill not in ToolCardRouter switch).

STATUS: This card is wired up but almost never renders. Skill activation
in practice flows through SkillLoadedCard (see #10b), not via a model-
emitted Skill tool_use. The Claude CLI's SkillTool is technically callable
by the model but in normal usage skills are user-driven (typed `/skill`
commands handled at the CLI input layer) — no Skill tool_use is emitted.

Recommendation: leave the registry entry in place as a fallback for the
rare case the model autonomously invokes Skill, but DO NOT prioritize
unifying this. The user-facing skill UX is SkillLoadedCard below.
```

### 10b. SkillLoadedCard (the actual user-visible skill pill)

Added in PR #247 (commit `6b6130dd`). Replaced the legacy "Using skill: X"
grey bubble. This is what users actually see when a skill activates.

```
DESKTOP (custom pill, NOT a CollapsibleToolCard)
File: packages/desktop/src/renderer/components/chat/assistant-ui/parts/tools/SkillLoadedCard.tsx

  Wiring:
    daemon emits 'system' message with content type 'skill_loaded'
    → convert-message.ts:67 puts {skillName, path, content} on meta.skillLoaded
    → SystemMessage.tsx reads meta.skillLoaded and renders SkillLoadedCard

  Collapsed (default):
                    ┌─ rounded-full, bg-mf-hover/50 ─────────────────────┐
                    │ ⚡ Using skill: brainstorming  ›                   │
                    │ ╰Zap(12) ╰mono [11px] sec  ╰accent ╰ChevronRight  │
                    └────────────────────────────────────────────────────┘
                    ╰ centered (flex flex-col items-center gap-2)
                    ╰ tooltip on hover: full path
                    ╰ hover:bg-mf-hover/70

  Expanded (chevron click):
                    ┌─ rounded-full, bg-mf-hover/50 ─────────────────────┐
                    │ ⚡ Using skill: brainstorming  ⌄                   │
                    └────────────────────────────────────────────────────┘
  ┌─ rounded-mf-card, border mf-divider, bg-mf-hover/20 ───────────────────┐
  │ # Skill content rendered as markdown                                   │
  │                                                                        │
  │ - Lists, headings, code blocks, tables                                 │
  │ - Uses markdownComponents + aui-md styles                              │
  │ ╰ max-h-[480px] overflow-y-auto                                        │
  └────────────────────────────────────────────────────────────────────────┘


MOBILE — NO EQUIVALENT EXISTS

  No skill_loaded handler in mobile components. Skills activate silently
  (or as system messages with no special rendering). User has no
  visibility into which skill was loaded.


UNIFIED DESIGN

  Keep desktop pill exactly as-is — it's recent (PR #247) and intentionally
  not a CollapsibleToolCard. Mobile gets a port of the same component:

    Collapsed pill:
      - centered horizontally
      - rounded-full pill, bg-mf-hover/50
      - Zap(12) icon + "Using skill: <name>" + ChevronRight
      - skill name in accent color
      - tap toggles expanded state

    Expanded body:
      - bordered markdown panel below the pill
      - max height, scrollable
      - same markdown renderer mobile already uses (MarkdownText)

  Differences from chat-stream cards:
    - Centered, not full-width
    - Pill shape (rounded-full), not rounded-mf-card
    - No status dot — skill activation is fire-and-forget
    - Triggered via system message, not assistant tool_use
```

### 11. AskUserQuestionToolCard

```
DESKTOP (CollapsibleToolCard, variant=compact, disabled until answered)

  Pending (disabled, no toggle):
  ┌──────────────────────────────────────────────────────────────────────┐
  │ ●  MsgCircleQuestion(15)  What approach do you prefer?              │
  │ ╰pulse   ╰accent/60           ╰body,sec/60                         │
  └─────────────────────────────────────────────────────────────────────┘

  Answered (collapsed):
  ┌──────────────────────────────────────────────────────────────────────┐
  │ ●  MsgCircleQuestion(15)  What approach...  — Option A  [↗ Maximize2]│
  │ ╰green ╰accent/60          ╰body,sec/60      ╰primary/70  ╰14px    │
  └─────────────────────────────────────────────────────────────────────┘

  Answered (expanded):
  ┌──────────────────────────────────────────────────────────────────────┐
  │ ●  MsgCircleQuestion(15)  What approach...  — Option A  [↙ Minimize2]│
  │                                                                     │
  │ Q: What approach do you prefer?               ╰small,primary/80     │
  │ [✓ Option A]  [ Option B ]  [ Option C ]      ╰option badges        │
  │ ╰selected: bg-accent/15, border-accent/30, text-accent             │
  │ ╰  Check(11) icon inside                                            │
  │ ╰unselected: bg-input-bg/40, sec/40, border-transparent            │
  │ ╰custom text answer: same styling as selected                       │
  │ Container: px-3, py-2, space-y-3                                    │
  └─────────────────────────────────────────────────────────────────────┘


MOBILE (CompactToolPill — no question/answer shown)

  ┌─ bg-#11121466, rounded-mf-card, px-3 py-1.5 ──────────────────────┐
  │ FileText(14)  AskUserQuestion                                ●     │
  │ ╰#a1a1aa66    ╰#a1a1aa99,xs,mono                        ╰2x2 dot  │
  └────────────────────────────────────────────────────────────────────┘
  No question text, no answer options. Generic pill.
```

### 12. PlanCard (ExitPlanMode)

```
DESKTOP (CollapsibleToolCard, variant=compact, disabled if no result)

  Collapsed / no result (disabled):
  ┌──────────────────────────────────────────────────────────────────────┐
  │ ◌  FileText(15)  Updated plan                                       │
  │ ╰ErrorDot ╰sec/40    ╰body,sec/60                                   │
  │ ╰no toggle (disabled)                                               │
  └─────────────────────────────────────────────────────────────────────┘

  Expanded (has result):
  ┌──────────────────────────────────────────────────────────────────────┐
  │ ◌  FileText(15)  Updated plan                          [↙ Minimize2]│
  │    ┃ ml-5, border-l border-mf-divider/50, py-1                      │
  │    ┃ Plan text content here...              max-h-[200px]           │
  │    ┃ ╰small,mono,sec/60,pre-wrap            overflow-y-auto        │
  └─────────────────────────────────────────────────────────────────────┘


MOBILE (CompactToolPill)

  ┌─ bg-#11121466, rounded-mf-card, px-3 py-1.5 ──────────────────────┐
  │ FileText(14)  ExitPlanMode                                   ●     │
  │ ╰#a1a1aa66    ╰#a1a1aa99,xs,mono                        ╰2x2 dot  │
  └────────────────────────────────────────────────────────────────────┘
```

### 13. DefaultToolCard (fallback for unhandled tools)

```
DESKTOP (CollapsibleToolCard, variant=primary)

  Collapsed:
  ┌──────────────────────────────────────────────────────────────────────┐
  │ ● Wrench(15)  WebFetch                                 [↗ Maximize2]│
  │ ╰StatusDot    ╰sec      ╰medium,primary                 ╰14px      │
  └─────────────────────────────────────────────────────────────────────┘

  Expanded:
  ┌──────────────────────────────────────────────────────────────────────┐
  │ ● Wrench(15)  WebFetch                                 [↙ Minimize2]│
  │──────────────────────────────── border-t ───────────────────────────│
  │ │ ARGUMENTS              ╰status,uppercase,semibold,tracking-wide  ││
  │ │ { "url": "https://…" } ╰mt-1,small,mono,sec,pre-wrap            ││
  │ │                                                                  ││
  │ │ RESULT                 (only if result exists)                   ││
  │ │ Page content here...   ╰mt-1,small,mono,primary,pre-wrap        ││
  │ │                        ╰max-h-[400px] overflow-y-auto            ││
  │ │ Error: bg-error-surface/20 border error-border/30 rounded p-2   ││
  │ └──────────────────────────────────────────────────────────────────┘│
  └─────────────────────────────────────────────────────────────────────┘


MOBILE (CompactToolPill)

  ┌─ bg-#11121466, rounded-mf-card, px-3 py-1.5 ──────────────────────┐
  │ FileText(14)  WebFetch                                       ●     │
  │ ╰#a1a1aa66    ╰#a1a1aa99,xs,mono                        ╰2x2 dot  │
  └────────────────────────────────────────────────────────────────────┘
```

---

## Unified Design Proposals (DRAFT — per-item review)

Drafted unified designs for every chat-stream tool card. Status legend:
- ✅ **APPROVED** — moved into the per-tool section above
- 🟡 **PENDING** — in this section, awaiting review
- ⚪ **DORMANT** — kept registered but not prioritized for unification
- ⛔ **OUT OF SCOPE** — handled by separate panel/sheet, not chat-stream

### Shared design principles (from approved BashCard)

1. Rounded card with `border-1 mf-border` outer
2. Status dot at row end (mobile pattern), no StatusDot at start
3. No Maximize2/Minimize2 toggle icon — whole header row is click target
4. Subheader/secondary info visible in both collapsed and expanded states
5. Error: red status dot + `border-1 mf-chat-error/30` (no separate layout)
6. Collapsed by default on both platforms, except diff cards (Edit, Write) which stay `defaultOpen`
7. Same `CollapsibleToolCard` contract on both platforms — mobile gets a port

### Card index

| # | Card | Status | Variant | Default state |
|---|---|---|---|---|
| U1 | BashCard | ✅ APPROVED | primary | collapsed |
| U2 | EditFileCard | 🟡 PENDING | primary | open |
| U3 | WriteFileCard | 🟡 PENDING | primary | open |
| U4 | ReadFileCard | 🟡 PENDING | compact | collapsed |
| U5 | SearchCard (Glob/Grep) | 🟡 PENDING | compact | collapsed |
| U6 | TaskCard | 🟡 PENDING | header + subheader, no collapse | — |
| U7 | TaskGroupCard | 🟡 PENDING | custom collapsible | collapsed |
| U8 | ToolGroupCard | 🟡 PENDING | compact | collapsed |
| U9 | PlanCard (ExitPlanMode result) | 🟡 PENDING | compact | collapsed |
| U10 | AskUserQuestionToolCard (answered) | 🟡 PENDING | compact | collapsed |
| U11 | DefaultToolCard | 🟡 PENDING | primary | collapsed |
| U12 | SkillLoadedCard | 🟡 PENDING | centered pill (custom) | collapsed |
| U13 | Markdown Code Block | 🟡 PENDING | not a tool card — markdown fence | — |
| U14 | EnterWorktree / ExitWorktree pills | 🟡 PENDING | centered pill (custom) | — |
| U15 | MCP tool call pill (`mcp__*`) | 🟡 PENDING | centered pill (custom) | collapsed |
| U16 | Schedule / Cron / Monitor pills | 🟡 PENDING | centered pill (custom) | varies |
| — | SlashCommandCard (Skill tool_use) | ⚪ DORMANT | — | — |
| — | TaskProgressCard (`_TaskProgress`) | ⚪ DORMANT | — | — |
| — | AskUserQuestion (pending) | ⛔ OUT OF SCOPE | bottom sheet | — |
| — | ExitPlanMode (pending approval) | ⛔ OUT OF SCOPE | bottom sheet | — |
| — | Permission | ⛔ OUT OF SCOPE | bottom sheet | — |

---

### U1. BashCard (✅ APPROVED) — primary, collapsed

```
COLLAPSED (default on both platforms):
┌─ rounded-mf-card, border-1 mf-border ──────────────────────────────┐
│ Terminal(15)  npm run build --filter=@qlan...                  ●   │
│ ╰sec          ╰mono,body,primary,truncate-80ch            ╰2x2 dot │
│               ╰tooltip:full command                  ╰done: success│
│                                                      ╰pend: pulse  │
│                                                      ╰err: error   │
│   Install project deps           ╰subheader, always visible        │
│   ╰small,sec,truncate,tooltip    ╰only if args.description exists  │
└─────────────────────────────────────────────────────────────────────┘
Whole card is clickable to expand (no Maximize2/Minimize2 icon).

EXPANDED (click card header row to toggle):
┌─ rounded-mf-card, border-1 mf-border ──────────────────────────────┐
│ Terminal(15)  npm run build --filter=@qlan...                  ●   │
│   Install project deps           ╰subheader stays visible          │
│──────────────────────────────── border-t mf-divider ───────────────│
│ │ PASS src/index.test.ts                                          ││
│ │ ✓ should work (23ms)                                            ││
│ │ ╰small,mono,sec,pre-wrap                                        ││
│ │ ╰max-h-[400px] overflow-y-auto                                  ││
│ └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘

Error state: same layout, red status dot, border-1 mf-chat-error/30,
error output shown in body.

Implementation notes:
  Desktop: still CollapsibleToolCard (variant=primary), with these tweaks:
    - statusDot prop → null (removed from start)
    - status dot moved into "trailing" slot (right end of row)
    - drop the Maximize2/Minimize2 icon render (whole header row is
      already the click target — icon was just a visual affordance)
    - subHeader rendered in BOTH open and closed states (currently
      only rendered when collapsed)
    - wrapperClassName picks up the outer border
  Mobile: switch from always-expanded custom card to collapsible
    component mirroring the desktop CollapsibleToolCard contract.

Changes from current:
  DESKTOP:
  - Remove StatusDot from start of row
  - Remove Maximize2/Minimize2 toggle icon
  - Add status dot at END of header row (mobile style)
  - Add outer border (mobile style: border-1 mf-border)
  - subheader stays visible in both collapsed AND expanded states
  MOBILE:
  - Add collapse/expand (collapsed by default, click header to toggle)
  - Add subheader (description) support
  - Add error border style (border-1 mf-chat-error/30)
  - Show full output when expanded (remove 8-line cap)
  BOTH:
  - Rounded card with border
  - Status dot at end
  - No expand/collapse icon — whole header row is the click target
  - subheader always visible when description exists
```

### U2. EditFileCard (🟡 PENDING) — primary, defaultOpen

```
COLLAPSED (rare — defaultOpen=true, but possible):
┌─ rounded-mf-card, border-1 mf-border ──────────────────────────────────┐
│ Pencil  FileTypeIcon  src/foo.ts          +3   -1   [⧉ desktop only] ● │
│ ╰sec    ╰per-ext      ╰mono,accent,clickable ╰badges ╰link            │
│                        ╰tooltip:full path     ╰rounded-full           │
└────────────────────────────────────────────────────────────────────────┘

EXPANDED (default):
┌─ rounded-mf-card, border-1 mf-border ──────────────────────────────────┐
│ Pencil  FileTypeIcon  src/foo.ts          +3   -1   [⧉ desktop only] ● │
│────────────────────────────── border-t mf-divider ─────────────────────│
│  42  │     │ - │ old line                          max-h-[300px]      │
│      │  43 │ + │ new line                          overflow-y-auto    │
│  44  │  44 │   │ context                                               │
└────────────────────────────────────────────────────────────────────────┘

Changes from current:
  DESKTOP:
    - prepend Pencil(15) icon before the existing FileTypeIcon
      (Pencil signals the action "edit", FileTypeIcon signals the file type)
    - status dot moves from start to trailing slot (after ⧉ button)
    - drop Maximize2/Minimize2 icon
  MOBILE:
    - keep Pencil icon (already used)
    - add FileTypeIcon (currently mobile shows Pencil only)
    - HIDE ⧉ "open in diff editor" button (desktop-only feature —
      no editor pane on mobile to open into)
    - add line numbers + +/- column (currently just ▎ bar)
    - add hover/error states
    - keep horizontal scroll, +/- badges
  Error: red status dot + border-1 mf-chat-error/30
```

### U3. WriteFileCard (🟡 PENDING) — primary, defaultOpen

```
EXPANDED (default):
┌─ rounded-mf-card, border-1 mf-border ──────────────────────────────────┐
│ Pencil  FileTypeIcon  src/new.ts               +25  [⧉ desktop only] ● │
│────────────────────────────── border-t ────────────────────────────────│
│      │  1 │ + │ import { x } from 'y';          max-h-[300px]         │
│      │  2 │ + │ const z = ...                                          │
│ ╰all green (added). hunks if available, else line-by-line.             │
└────────────────────────────────────────────────────────────────────────┘

Changes:
  DESKTOP: prepend Pencil(15) before existing FileTypeIcon (match Edit)
           status dot to trailing
  MOBILE:  keep Pencil icon (already used)
           add FileTypeIcon (currently mobile shows Pencil only)
           HIDE ⧉ "open in diff editor" button (desktop-only)
           show full file content (currently shows nothing — pill only)
           line numbers, +/- column
           +/- badges in header
```

### U4. ReadFileCard (🟡 PENDING) — compact, collapsed

```
COLLAPSED (mobile pattern: file icon + "Read" label + path):
┌─ rounded-mf-card, border-1 mf-border ────────────────────────────────┐
│ FileText  Read  src/foo.ts                                       ●   │
│ ╰sec/40   ╰sec  ╰ClickableFilePath, accent, hover:underline          │
└──────────────────────────────────────────────────────────────────────┘

EXPANDED:
┌─ rounded-mf-card, border-1 mf-border ────────────────────────────────┐
│ FileText  Read  src/foo.ts                                       ●   │
│────────────────────────────── border-t ──────────────────────────────│
│   1 │ import { x } from 'y';            max-h-[300px]                │
│   2 │ const z = ...                     overflow-y-auto              │
│ ╰w-10,r,opc-30  ╰sec,opc-60                                          │
└──────────────────────────────────────────────────────────────────────┘

Changes:
  DESKTOP: swap Eye → FileText icon + "Read" label (mobile pattern —
           explicit action label is clearer than icon alone)
           replace ErrorDot at start with success+error dot at trailing
           add outer border (currently no border on compact variant)
  MOBILE:  keep FileText icon + "Read" label (already present)
           add file content view when expanded (currently empty pill)
           clickable path
```

### U5. SearchCard (Glob / Grep) (🟡 PENDING) — compact, collapsed

```
COLLAPSED (mobile pattern: magnifier + Grep/Glob label as primary,
            pattern in subheader, optional path in subheader too):
┌─ rounded-mf-card, border-1 mf-border ────────────────────────────────┐
│ Search  Grep                                                     ●   │
│ ╰sec/40 ╰sec,medium                                                  │
│   "pattern"  ·  in src/auth/   ╰subheader, always visible            │
│   ╰mono,small,sec/60,truncate  ╰path optional, omitted if no `path` │
│   ╰tooltip:full pattern                                              │
└──────────────────────────────────────────────────────────────────────┘

EXPANDED:
┌─ rounded-mf-card, border-1 mf-border ────────────────────────────────┐
│ Search  Grep                                                     ●   │
│   "pattern"  ·  in src/auth/                                         │
│────────────────────────────── border-t ──────────────────────────────│
│ src/a.ts:42: matching line                  max-h-[300px]            │
│ src/b.ts:17: other match                                             │
└──────────────────────────────────────────────────────────────────────┘

Changes:
  DESKTOP: move pattern from header → subheader (cleaner header, longer
           pattern survives without truncating tool label)
           add optional `path` arg to subheader (` · in <path>` suffix)
           status dot at trailing
           outer border added
  MOBILE:  same restructure: tool label in header, pattern + path in subheader
           show results body when expanded (currently empty pill)
```

### U6. TaskCard (🟡 PENDING) — header + subheader, no collapse

Two rows: header has agent type + model + usage stats + status dot,
subheader has the description (short task title) with a Radix tooltip
that shows the full prompt.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Bot  general-purpose  opus              3 tools · 2k · 12s       ●   │
│ ╰accent ╰medium       ╰sec/50,mono      ╰sec/50,mono                 │
│   Fix the login bug                                                  │
│   ╰subheader: small,sec/70,truncate                                  │
│   ╰from args.description (short title, ~60 chars typical)            │
│   ╰tooltip on hover/focus → shows args.prompt (see tooltip rules)    │
└──────────────────────────────────────────────────────────────────────┘
No outer border. Status dot at end of header row.

Tooltip rules (Radix Tooltip, both platforms):
  - Source: args.prompt (the full task instructions)
  - max-width: ~480px
  - Whitespace pre-wrap so newlines render
  - If prompt > 600 chars: trim to 600 + "…" suffix
    (keeps the tooltip from dominating the viewport on huge prompts)
  - If args.prompt is missing/empty: fall back to args.description
  - If both are missing: no tooltip at all

Pending state (no result yet):
┌──────────────────────────────────────────────────────────────────────┐
│ Bot  general-purpose  opus                                       ●   │
│   Fix the login bug                                ╰pending pulse    │
└──────────────────────────────────────────────────────────────────────┘
(Usage stats omitted until result arrives.)

Changes from current:
  DESKTOP:
    - move description from header → subheader (currently it's in the
      header row, truncated at 60 chars)
    - swap tooltip source from args.description → args.prompt
      (description is already visible as the subheader text;
       tooltip should reveal the richer info — the actual prompt)
    - apply 600-char trim rule to tooltip content
  MOBILE:
    - same layout change: header + subheader
    - add accent color on agent type, model badge, usage stats
      (currently a generic gray pill with no styling)
    - port the same tooltip rules
```

### U7. TaskGroupCard (🟡 PENDING) — custom collapsible

```
COLLAPSED:
┌──────────────────────────────────────────────────────────────────────┐
│ Bot  general-purpose  opus  "Fix login"   Read 3 · Searched 1    ●   │
│ ╰accent ╰medium       ╰sec  ╰truncate     ╰summary,sec/50,mono       │
└──────────────────────────────────────────────────────────────────────┘
No outer border. Single row.

EXPANDED:
┌──────────────────────────────────────────────────────────────────────┐
│ Bot  general-purpose  opus  "Fix login"   Read 3 · Searched 1    ●   │
│   ├─ Eye    src/auth.ts                                          ●   │
│   ├─ Search Grep "password"                                      ●   │
│   ├─ FileIcon src/auth.ts +5 -2                                  ●   │
│   └─ Done. Fixed auth validation...                                  │
│      ╰pl-6, small, sec, pre-wrap                                     │
└──────────────────────────────────────────────────────────────────────┘
Children rendered as their own unified cards (compact variants).

Changes:
  DESKTOP: drop Maximize2/Minimize2 icon (whole row clickable)
  MOBILE:  fix bug (block.agentType → block.agentId)
           fix bug (block.description → block.taskArgs.description)
           add summary, model, accent color, usage stats
           add collapse/expand
```

### U8. ToolGroupCard (🟡 PENDING) — compact

```
COLLAPSED:
┌─ rounded-mf-card, border-1 mf-border ────────────────────────────────┐
│ Layers  Read 3 files · Searched 2 patterns                       ●   │
│ ╰sec/40 ╰sec/60                                                      │
└──────────────────────────────────────────────────────────────────────┘

EXPANDED:
┌─ rounded-mf-card, border-1 mf-border ────────────────────────────────┐
│ Layers  Read 3 files · Searched 2 patterns                       ●   │
│────────────────────────────── border-t ──────────────────────────────│
│ Eye    src/a.ts                                                  ●   │
│ Eye    src/b.ts                                                  ●   │
│ Search "pattern1"                                                ●   │
└──────────────────────────────────────────────────────────────────────┘

Changes:
  DESKTOP: outer border added; status dot at trailing
  MOBILE:  add this whole component (currently no grouping at all —
           each tool call renders separately)
```

### U9. PlanCard (ExitPlanMode result) (🟡 PENDING) — compact

```
COLLAPSED:
┌─ rounded-mf-card, border-1 mf-border ────────────────────────────────┐
│ FileText  Updated plan                                           ●   │
│ ╰sec/40   ╰sec/60                                                    │
└──────────────────────────────────────────────────────────────────────┘

EXPANDED:
┌─ rounded-mf-card, border-1 mf-border ────────────────────────────────┐
│ FileText  Updated plan                                           ●   │
│────────────────────────────── border-t ──────────────────────────────│
│ Plan text content here...                  max-h-[200px]             │
└──────────────────────────────────────────────────────────────────────┘

Changes:
  DESKTOP: outer border, status dot trailing
  MOBILE:  show plan text when expanded (currently empty pill)

Note: this is the post-approval ExitPlanMode result card. The pending
approval flow is handled by PlanApprovalCard (BottomCard, out of scope).
```

### U10. AskUserQuestionToolCard (answered/historical) (🟡 PENDING) — compact

```
COLLAPSED:
┌─ rounded-mf-card, border-1 mf-border ────────────────────────────────┐
│ HelpCircle  What approach...  — Option A                         ●   │
│ ╰accent/60  ╰sec/60           ╰primary/70,short answer preview       │
└──────────────────────────────────────────────────────────────────────┘

EXPANDED:
┌─ rounded-mf-card, border-1 mf-border ────────────────────────────────┐
│ HelpCircle  What approach...  — Option A                         ●   │
│────────────────────────────── border-t ──────────────────────────────│
│ Q: What approach do you prefer?                                      │
│ [✓ Option A]  [ Option B ]  [ Option C ]                             │
└──────────────────────────────────────────────────────────────────────┘

Changes:
  DESKTOP: outer border, status dot trailing
  MOBILE:  build this component for the answered state
           (the pending AskUserQuestionCard sheet already exists and
           stays as-is, out of scope)
```

### U11. DefaultToolCard (🟡 PENDING) — primary

```
COLLAPSED:
┌─ rounded-mf-card, border-1 mf-border ────────────────────────────────┐
│ Wrench  WebFetch                                                 ●   │
│ ╰sec    ╰medium,primary                                              │
└──────────────────────────────────────────────────────────────────────┘

EXPANDED:
┌─ rounded-mf-card, border-1 mf-border ────────────────────────────────┐
│ Wrench  WebFetch                                                 ●   │
│────────────────────────────── border-t ──────────────────────────────│
│ ARGUMENTS                                                            │
│ { "url": "https://..." }                                             │
│                                                                      │
│ RESULT                                                               │
│ ...                                          max-h-[400px]           │
└──────────────────────────────────────────────────────────────────────┘

Changes:
  DESKTOP: status dot to trailing
  MOBILE:  build this component (currently every unhandled tool is
           a CompactToolPill with no body)
```

### U12. SkillLoadedCard (🟡 PENDING) — centered pill, custom

```
DESKTOP (current): centered rounded-full pill, see section 10b above.

UNIFIED DESIGN

  Keep desktop pill exactly as-is (PR #247 — intentionally NOT a
  CollapsibleToolCard because it's centered + rounded-full, not a
  full-width row). Mobile gets a port of the same component:

  Collapsed:
                    ┌─ rounded-full, bg-mf-hover/50 ─────────────────────┐
                    │ ⚡ Using skill: brainstorming  ›                   │
                    └────────────────────────────────────────────────────┘

  Expanded (chevron tap):
                    ┌─ rounded-full ─────────────────────────────────────┐
                    │ ⚡ Using skill: brainstorming  ⌄                   │
                    └────────────────────────────────────────────────────┘
  ┌─ rounded-mf-card, border mf-divider, bg-mf-hover/20 ───────────────────┐
  │ # Skill content rendered as markdown                                   │
  │ - Lists, headings, code blocks, tables                                 │
  │ ╰ max-h-[480px] overflow-y-auto                                        │
  └────────────────────────────────────────────────────────────────────────┘

Changes:
  DESKTOP: none (recently shipped, intentional design)
  MOBILE:  build SkillLoadedCard equivalent
           - read meta.skillLoaded from system message
           - render centered pill with Zap icon + "Using skill: <name>"
           - tap chevron toggles markdown body
           - reuse existing MarkdownText for the body

Differences from chat-stream cards:
  - Centered, not full-width
  - Pill shape (rounded-full), not rounded-mf-card
  - No status dot — skill activation is fire-and-forget
  - Triggered via system message + meta.skillLoaded, not assistant tool_use
```

### U13. Markdown Code Block (🟡 PENDING) — not a tool card

Inside rendered markdown content (assistant text), fenced code blocks
have a header row (language label + Copy button) above the syntax-
highlighted content.

```
DESKTOP (current — header visually separated by border):
  ┌─ rounded-mf-card, border mf-divider, bg-mf-input-bg ────────────────┐
  │ ts                                                          📋 Copy │
  │ ╰small,mono,sec   ╰bg-mf-hover/50, opacity-0 group-hover:opacity-100│
  │─────────────────── border-b mf-divider ← visible separator ─────────│
  │ onTodoUpdate(todos: TodoItem[]) {                                   │
  │   db.chats.updateTodos(chatId, todos);                              │
  │   ...                                                               │
  │ }                                                                   │
  └─────────────────────────────────────────────────────────────────────┘
  Header row: bg-mf-hover/50 (lighter)
  Content:    bg-mf-input-bg (darker)
  Divider:    border-b mf-divider between them

MOBILE (current — header integrated into same code background):
  ┌─ dark code background ──────────────────────────────────────────────┐
  │ ts                                                              📋  │
  │─ no border, same bg as content ─────────────────────────────────────│
  │ onTodoUpdate(todos: TodoItem[]) {                                   │
  │   ...                                                               │
  │ }                                                                   │
  └─────────────────────────────────────────────────────────────────────┘


UNIFIED DESIGN (mobile pattern wins)

  ┌─ rounded-mf-card, border mf-divider, bg-mf-input-bg ────────────────┐
  │ ts                                                          📋 Copy │
  │ ╰small,mono,sec/60                 ╰opacity-0 group-hover:opacity-100│
  │ ─ no border-b ─ same bg as content below ───────────────────────── │
  │ onTodoUpdate(todos: TodoItem[]) {                                   │
  │   db.chats.updateTodos(chatId, todos);                              │
  │ }                                                                   │
  └─────────────────────────────────────────────────────────────────────┘

Changes from current:
  DESKTOP (CodeHeader.tsx):
    - drop `border-b border-mf-divider` from the header row
    - drop `bg-mf-hover/50` from the header → use transparent (so it
      inherits the code block's bg-mf-input-bg)
    - keep the language label and Copy button (functionality unchanged)
  MOBILE: no change.

  Result on desktop: header and content share the same dark code
  background, visually integrated as one block. Card border + rounded
  corners stay on the outer .aui-md-pre.
```

### U14. EnterWorktree / ExitWorktree pills (🟡 PENDING) — centered pill, custom

Both tools are currently rendered by the generic DefaultToolCard (desktop)
or CompactToolPill (mobile). Promote them to dedicated centered pills
following the SkillLoadedCard pattern — these are session-state changes,
not work output, so they deserve a compact, distinct treatment.

```
EnterWorktree (success):
                    ┌─ rounded-full, bg-mf-hover/50 ─────────────────────┐
                    │ 🌿 Entered worktree: feat/tool-cards               │
                    │ ╰GitBranch(12) sec  ╰mono [11px] sec  ╰accent      │
                    └────────────────────────────────────────────────────┘
                    ╰ centered (flex justify-center)
                    ╰ tooltip on hover: full worktreePath

ExitWorktree (success, action='keep'):
                    ┌─ rounded-full, bg-mf-hover/50 ─────────────────────┐
                    │ 🌿 Exited worktree (kept)                          │
                    └────────────────────────────────────────────────────┘

ExitWorktree (success, action='remove'):
                    ┌─ rounded-full, bg-mf-hover/50 ─────────────────────┐
                    │ 🌿 Removed worktree                                │
                    └────────────────────────────────────────────────────┘

Pending state (no result yet):
                    ┌─ rounded-full, bg-mf-hover/50 ─────────────────────┐
                    │ 🌿 Entering worktree…                          ●   │
                    │                                            ╰pulse  │
                    └────────────────────────────────────────────────────┘

Error state:
                    ┌─ rounded-full, border mf-chat-error/30 ────────────┐
                    │ 🌿 Failed to enter worktree                    ●   │
                    │                                            ╰red    │
                    └────────────────────────────────────────────────────┘
                    ╰ tooltip shows error message from result

Behavior:
  - Centered pill, NOT full-width row (mirrors SkillLoadedCard)
  - GitBranch icon (lucide-react) — both Enter and Exit use it
  - Label text derived from tool + args + result:
      EnterWorktree pending: "Entering worktree…"
      EnterWorktree done:    "Entered worktree: <branch or name>"
      ExitWorktree pending:  "Exiting worktree…"
      ExitWorktree done:     "Exited worktree (kept)" | "Removed worktree"
  - Worktree branch/name in accent color (like SkillLoadedCard skill name)
  - Tooltip:
      Enter success → full worktreePath
      Exit success  → original cwd restored to
      Error         → result.content (error message)
  - No collapse/expand — these are status updates, not browseable content
  - No status dot for success (tool name + done state implies it)
  - Pending: pulse dot at end
  - Error: red dot at end + error border

Implementation notes:
  - Both share a single WorktreeStatusPill component (parameterized by
    direction: 'enter' | 'exit')
  - Desktop: register in tool-ui-registry.tsx and render-tool-card.tsx
    for toolName 'EnterWorktree' and 'ExitWorktree'
  - Mobile: add cases to ToolCardRouter
  - Both platforms use the same shape as SkillLoadedCard (centered,
    rounded-full, no full-width row)
```

### U15. MCP tool call pill (🟡 PENDING) — centered pill, custom

Tools matching the pattern `mcp__<server>__<tool>` get a dedicated pill
that signals MCP usage explicitly. Replaces the current DefaultToolCard
fallback (desktop) and CompactToolPill (mobile).

```
Tool name parsing:
  raw:    mcp__claude_ai_Notion__notion-search
  server: claude_ai_Notion         → display "Notion"  (strip claude_ai_ prefix)
  tool:   notion-search            → display "notion-search" (as-is)

  raw:    mcp__pencil__batch_design
  server: pencil                   → display "Pencil" (capitalize)
  tool:   batch_design             → display "batch_design"

Display rules:
  - Strip `claude_ai_` prefix from server name
  - Capitalize first letter of server (lower-case → Title-case)
  - Tool name shown as-is (often kebab/snake_case is meaningful)


Pending state:
                    ┌─ rounded-full, bg-mf-hover/50 ─────────────────────┐
                    │ ⚙ Notion executing notion-search …             ●   │
                    │ ╰Plug(12) sec  ╰mono [11px] sec   ╰accent  ╰pulse  │
                    └────────────────────────────────────────────────────┘
                    ╰ centered

Done (collapsed, default):
                    ┌─ rounded-full, bg-mf-hover/50 ─────────────────────┐
                    │ ⚙ Notion executed notion-search                ›   │
                    │ ╰Plug(12)  ╰sec        ╰accent             ╰chevron│
                    └────────────────────────────────────────────────────┘

Done (expanded, chevron tap):
                    ┌─ rounded-full, bg-mf-hover/50 ─────────────────────┐
                    │ ⚙ Notion executed notion-search                ⌄   │
                    └────────────────────────────────────────────────────┘
  ┌─ rounded-mf-card, border mf-divider, bg-mf-hover/20 ───────────────────┐
  │ ARGUMENTS                                                              │
  │ { "query": "tool card design", "limit": 5 }                            │
  │                                                                        │
  │ RESULT                                                                 │
  │ Found 3 pages: ...                                                     │
  │ ╰ small, mono, sec/60, pre-wrap                                        │
  │ ╰ max-h-[400px] overflow-y-auto                                        │
  └────────────────────────────────────────────────────────────────────────┘

Error state:
                    ┌─ rounded-full, border mf-chat-error/30 ────────────┐
                    │ ⚙ Notion failed: notion-search                 ●   │
                    │                                            ╰red    │
                    └────────────────────────────────────────────────────┘
                    ╰ tooltip shows error message from result

Behavior:
  - Centered pill, NOT full-width row (mirrors SkillLoadedCard / U14)
  - Plug icon (lucide-react) — distinguishes MCP from skills (Zap)
                              and worktrees (GitBranch)
  - Label format: "<Server> executing/executed <tool>"
      pending: "executing"
      done:    "executed"
      error:   "failed:"
  - Server name in default sec, tool name in accent (mirrors how
    SkillLoadedCard accents the skill name)
  - Tooltip on hover: full raw tool name (`mcp__<server>__<tool>`)
    so debugging unmangled names stays accessible
  - Chevron only when result exists; pending state shows pulse dot instead
  - Expanded body: ARGUMENTS + RESULT panel below the pill
    (same shape as the desktop DefaultToolCard expanded body, but rendered
     under the centered pill)
  - Error: red dot + error border on pill, tooltip shows error content

Implementation notes:
  - Single MCPToolCard component
  - Detection: any toolName starting with `mcp__` (not just specific servers)
  - Desktop: register a wildcard handler in render-tool-card.tsx —
    `if (toolName.startsWith('mcp__')) return <MCPToolCard ... />`
    This takes priority over DefaultToolCard fallback.
  - Mobile: add wildcard branch to ToolCardRouter switch (default case
    checks startsWith before falling to CompactToolPill)
  - Both platforms parse `mcp__(.+?)__(.+)` to split server/tool

Excluded from this card:
  - `mcp__<server>__authenticate` — these are McpAuthTool OAuth flows.
    They return an authorization URL rather than tool output, so they
    deserve their own treatment (could reuse this same pill but with
    a different label "<Server> requires authentication" + clickable URL).
    Out of scope for U15; flag as follow-up.
```

### U16. Schedule / Cron / Monitor pills (🟡 PENDING) — centered pill, custom

Group of automation/timing tools that all signal "the agent set up
something to run later or in the background". Same pill family as
SkillLoadedCard / U14 / U15. Single shared component
`SchedulePill`, parameterized by tool name.

Tools covered:
  - ScheduleWakeup
  - CronCreate / CronDelete / CronList
  - Monitor

```
Icons (lucide-react):
  ScheduleWakeup → AlarmClock(12)
  CronCreate     → CalendarClock(12)
  CronDelete     → CalendarX(12)
  CronList       → CalendarDays(12)
  Monitor        → Activity(12)

All in default sec colour. The label text + accented value
distinguishes them.


### ScheduleWakeup

Pending (the wakeup is being scheduled — usually instant):
                    ┌─ rounded-full, bg-mf-hover/50 ─────────────────────┐
                    │ ⏰ Scheduling wakeup in 5m …                   ●   │
                    │ ╰AlarmClock(12) sec                          ╰pulse│
                    └────────────────────────────────────────────────────┘

Done:
                    ┌─ rounded-full, bg-mf-hover/50 ─────────────────────┐
                    │ ⏰ Will resume in 5m  ·  "checking deploy"         │
                    │ ╰sec        ╰accent (delay)  ╰sec/60, truncate     │
                    └────────────────────────────────────────────────────┘
                    ╰ delay formatted human-readable (60s→1m, 1800s→30m)
                    ╰ reason after dot, truncated, tooltip = full reason
                    ╰ tooltip on the pill = the prompt that will fire


### CronCreate

Pending:
                    ┌─ rounded-full, bg-mf-hover/50 ─────────────────────┐
                    │ 📅 Creating schedule …                          ●  │
                    └────────────────────────────────────────────────────┘

Done:
                    ┌─ rounded-full, bg-mf-hover/50 ─────────────────────┐
                    │ 📅 Scheduled: every weekday at 9am  · recurring    │
                    │ ╰CalendarClock ╰accent (humanSchedule)  ╰sec/60   │
                    └────────────────────────────────────────────────────┘
                    ╰ humanSchedule comes from result
                    ╰ trailing badge: "recurring" or "one-shot"
                    ╰ if durable=false: extra " · session-only" badge
                    ╰ tooltip on pill: full prompt + cron expression


### CronDelete

Done:
                    ┌─ rounded-full, bg-mf-hover/50 ─────────────────────┐
                    │ 🗓 Removed schedule  ·  abc-123                    │
                    │ ╰CalendarX  ╰sec               ╰accent,mono [11px] │
                    └────────────────────────────────────────────────────┘
                    ╰ id from args.id


### CronList

Done:
                    ┌─ rounded-full, bg-mf-hover/50 ─────────────────────┐
                    │ 🗓 Listed 3 scheduled jobs                      ›  │
                    │ ╰CalendarDays ╰sec   ╰accent count       ╰chevron │
                    └────────────────────────────────────────────────────┘

Done (expanded):
                    ┌─ rounded-full ─────────────────────────────────────┐
                    │ 🗓 Listed 3 scheduled jobs                      ⌄  │
                    └────────────────────────────────────────────────────┘
  ┌─ rounded-mf-card, border mf-divider, bg-mf-hover/20 ───────────────────┐
  │ • abc-123  every weekday at 9am  (recurring, durable)                  │
  │   prompt: "/check deploy status"                                       │
  │ • def-456  one-shot at 2026-04-30 14:00                                │
  │   prompt: "/run weekly review"                                         │
  │ ╰ small, mono, sec/60                                                  │
  │ ╰ max-h-[300px] overflow-y-auto                                        │
  └────────────────────────────────────────────────────────────────────────┘


### Monitor

Pending (long-running — this is the typical state):
                    ┌─ rounded-full, bg-mf-hover/50 ─────────────────────┐
                    │ 📡 Monitoring: deploy progress                 ●   │
                    │ ╰Activity ╰sec       ╰accent (description)  ╰pulse │
                    └────────────────────────────────────────────────────┘

Done (process exited):
                    ┌─ rounded-full, bg-mf-hover/50 ─────────────────────┐
                    │ 📡 Stopped monitoring: deploy progress          ›  │
                    └────────────────────────────────────────────────────┘
                    ╰ chevron expands to show buffered output (last N lines)


### Error state (any of the above)

                    ┌─ rounded-full, border mf-chat-error/30 ────────────┐
                    │ ⏰ Failed to schedule wakeup                   ●   │
                    │                                            ╰red    │
                    └────────────────────────────────────────────────────┘
                    ╰ tooltip shows error message from result


Behavior (all variants):
  - Centered pill, NOT full-width row (pill family — SkillLoadedCard,
    U14, U15)
  - No status dot for success (label conveys completion)
  - Pending: pulse dot at end
  - Error: red dot + error border on pill, tooltip = error message
  - Chevron only when there's expandable content (CronList items,
    Monitor output buffer)
  - Tooltips on the pill carry the rich detail (full prompt, cron expr,
    raw output) so the pill itself stays compact

Implementation notes:
  - Single SchedulePill component, branched by toolName
  - Detection: explicit switch in render-tool-card.tsx / ToolCardRouter
    for the 5 tool names
  - Both platforms: same shape (centered, rounded-full)
  - Reuse format helpers:
      formatDuration() from TaskCard already handles 60s→1m, 1800s→30m
      humanSchedule comes pre-formatted from CronCreate result
```

---

## Special Content Types (non-tool)

### 14. Thinking Block

```
DESKTOP: Reasoning component returns null (hidden completely).

MOBILE (current — to be removed):
  Inline in ContentBlock switch:
  ┌─ bg-#11121466, rounded-mf-card, px-3 py-1.5 ──────────────────────┐
  │ Brain(14)  Thinking...     ← shown if text > 80 chars              │
  │ ╰#a1a1aa66  ╰#a1a1aa99     ← else shows full thinking text         │
  └────────────────────────────────────────────────────────────────────┘

DECISION (both platforms): hide thinking blocks entirely.
  - Desktop: already done.
  - Mobile: remove the `case 'thinking'` branch from AssistantMessage's
    ContentBlock switch so it falls through to default (null). Per #31.
```

### 15. Image in User Message

```
DESKTOP (ImageThumbs component):
                                                ┌────┐ ┌────┐
                                    max-w-[75%] │    │ │    │
                                    flex-wrap    │ img│ │ img│
                                    justify-end  │    │ │    │
                                                └────┘ └────┘
                                                ╰w-16 h-16 (64px)
                                                ╰rounded, overflow-hidden
                                                ╰hover:ring-2 ring-mf-accent
                                                ╰click → ImageLightbox
                                                ╰object-cover

MOBILE (UserMessage component):
  ┌──────────┐  ┌──────────┐
  │          │  │          │    ← single image: w-200
  │   image  │  │   image  │    ← multiple: w-120
  │          │  │          │    ← rounded-mf-card
  │          │  │          │    ← click → ImageLightbox
  └──────────┘  └──────────┘
  Text content below images
  ╰base64 URI: data:${mediaType};base64,${data}
```

### 16. Image in Assistant Message

```
DESKTOP (current — handled): Renders inline via ImageThumbs + lightbox.
  Shipped in PR #237 (commit 99ae306c, "feat(chat): render agent image
  responses inline"). AssistantMessage.tsx reads image blocks from the
  original DisplayMessage via getExternalStoreMessages and renders them
  with the same ImageThumbs + openLightbox pattern as UserMessage.

MOBILE (current — broken): No case branch in ContentBlock → returns null.
  Assistant images silently dropped.

DECISION: mobile parity with desktop. Add `case 'image'` to mobile's
  AssistantMessage ContentBlock switch. Use the same Image + lightbox
  rendering already present in mobile's UserMessage.
```

### 17. Permission Message

```
DESKTOP: Rendered as BottomCard (replaces composer):
  - AskUserQuestion → AskUserQuestionCard
  - ExitPlanMode → PlanApprovalCard
  - Other tools → PermissionCard
  Message content: PERMISSION_PLACEHOLDER sentinel → MainframeText returns null

MOBILE:
  - permission_request case in ContentBlock → returns null
  - PermissionCardRouter exists separately (outside message list)
  - See also #57
```

---

## Hidden Tools

### Current state — divergence

**Desktop** uses an explicit hardcoded list in `tool-ui-registry.tsx`
(`HIDDEN_TOOLS` array, renders `() => null`) AND a duplicate set in
`render-tool-card.tsx` (`HIDDEN_TOOL_NAMES` Set):
- `TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet`, `TaskOutput`, `TaskStop`
- `TodoWrite`, `EnterPlanMode`, `ToolSearch`
- Plus `AskUserQuestion` in the render-tool-card Set only

**Mobile** uses the daemon-provided category in `ToolCardRouter`:
```typescript
if (category === 'hidden') return null;
```
Relies on adapter's `getToolCategories().hidden` Set.

### Decision: daemon is the source of truth

The Claude adapter (`packages/core/src/plugins/builtin/claude/adapter.ts`)
already declares the canonical hidden set via `getToolCategories()`. Both
platforms should consume that set rather than maintaining their own.

**Changes:**
- **Daemon**: ensure `getToolCategories().hidden` is the complete authoritative
  list. Currently it has: `TaskList, TaskGet, TaskOutput, TaskStop, TodoWrite,
  Skill, EnterPlanMode, AskUserQuestion, ToolSearch`. Reconcile with desktop's
  hardcoded list — add the missing `TaskCreate`, `TaskUpdate` (and verify
  `Skill` belongs given the `SkillLoadedCard` pill flow).
- **Desktop**: drop the hardcoded `HIDDEN_TOOLS` array and `HIDDEN_TOOL_NAMES`
  Set. Read `toolCall.category === 'hidden'` from the DisplayContent block
  (same pattern as mobile). The `tool-ui-registry.tsx` registrations for
  hidden tools become unnecessary.
- **Mobile**: no change — already uses category-based filtering.

This eliminates the two divergent lists and the duplicated logic across
`tool-ui-registry.tsx` and `render-tool-card.tsx`.

### Unhandled Tools (fall to generic default on both platforms)

| Tool | Desktop (DefaultToolCard) | Mobile (CompactToolPill) | Suggested |
|---|---|---|---|
| `WebFetch` | Shows args+result | Generic pill | ? |
| `WebSearch` | Shows args+result | Generic pill | ? |
| `NotebookEdit` | Shows args+result | Generic pill | ? |
| `LSP` | Shows args+result | Generic pill | ? |
| `EnterWorktree` | Shows args+result | Generic pill | **Centered pill — see U14** |
| `ExitWorktree` | Shows args+result | Generic pill | **Centered pill — see U14** |
| `RemoteTrigger` | Shows args+result | Generic pill | ? |
| `CronCreate` | Shows args+result | Generic pill | **Centered pill — see U16** |
| `CronDelete` | Shows args+result | Generic pill | **Centered pill — see U16** |
| `CronList` | Shows args+result | Generic pill | **Centered pill — see U16** |
| `ScheduleWakeup` | Shows args+result | Generic pill | **Centered pill — see U16** |
| `Monitor` | Shows args+result | Generic pill | **Centered pill — see U16** |
| `Config` | Shows args+result | Generic pill | Hide? |
| `ReadMcpResourceTool` | Shows args+result | Generic pill | ? |
| `ListMcpResourcesTool` | Shows args+result | Generic pill | ? |
| `REPL` | Shows args+result | Generic pill | ? |
| `PowerShell` | Shows args+result | Generic pill | ? |
| `TeamCreate` | Shows args+result | Generic pill | ? |
| `TeamDelete` | Shows args+result | Generic pill | ? |
| `Sleep` | Shows args+result | Generic pill | Hide? |
| `StructuredOutput` | Shows args+result | Generic pill | Hide? |
| `SendMessage` | Shows args+result | Generic pill | Hide? |
| `mcp__*` | Shows args+result | Generic pill | **Centered pill — see U15** |

---

## Known Bugs

1. **Mobile `task_group` reads `block.agentType`** — field doesn't exist on `DisplayContent` type. Should be `block.agentId`.
2. **Mobile `task_group` reads `block.description`** — field doesn't exist on type. Should use `block.taskArgs.description` or similar.
3. **Mobile `image` in assistant messages** — no case branch in ContentBlock, silently dropped.
4. **Mobile thinking blocks** — shows "Thinking..." pill, should be hidden (per #31).
5. **Desktop image in assistant messages** — skipped in convert-message.ts (no conversion for image blocks in assistant context).
6. **`SlashCommandCard` is dormant** — registered for `Skill` tool_use but the Claude CLI doesn't emit `Skill` tool_use for user-typed slash commands (those are handled at the CLI input layer). Skill activation flows through `SkillLoadedCard` (PR #247) instead. Card is dead code in normal usage. See section 10 + 10b.
7. **`_TaskProgress` is dormant** — registered to render `TaskProgressCard` but only fires on `TaskCreate`/`TaskUpdate` (TodoV2). The Claude CLI uses TodoV1 (`TodoWrite`) which is hidden. Live task progress flows through `TasksSection` (Context tab) and `TodosPanel` via daemon-side `onTodoUpdate` interception. Card is dead code in normal usage.
8. **Mobile has no `SkillLoadedCard` equivalent** — desktop renders the centered "Using skill: X" pill on skill activation; mobile silently drops the `skill_loaded` system message.
9. **Mobile has no `TasksSection` equivalent** — desktop shows live chat todos in the Context tab; mobile has no equivalent surface for `chat.todos`.

---

## CLI Tools — Data Model

Every tool's input schema (model-facing args) and output shape (assistant-visible result).
"Side effects" called out only when notable.

### `Bash` (BashTool)
**Input:**
- `command` (string, required) — shell command to execute
- `description` (string, optional) — short human-readable description (subheader)
- `run_in_background` (boolean, optional) — fire-and-forget mode
- `timeout` (number, optional) — max ms (cap 600000)

**Result:** stdout/stderr concatenated as text; structured object with `stdout`, `stderr`, `exitCode`, `signal` available internally.
**Side effects:** spawns shell process; arbitrary fs/env mutation.

### `Edit` (FileEditTool)
**Input:**
- `file_path` (string, required, absolute)
- `old_string` (string, required)
- `new_string` (string, required)
- `replace_all` (boolean, optional, default false)

**Result:** `{ filePath, oldString, newString, originalFile, structuredPatch (DiffHunk[]), replaceAll, userModified, gitDiff? }`.
**Side effects:** writes file; LSP refresh; VSCode notify; file history snapshot.

### `Read` (FileReadTool)
**Input:**
- `file_path` (string, required, absolute)
- `offset` (number, optional, 1-based start line)
- `limit` (number, optional, line count)
- `pages` (string, optional, PDF range e.g. `"1-5"`, max 20)

**Result:** discriminated union by `type`:
- `text`: `{ filePath, content, numLines, startLine, totalLines }`
- `image`: `{ base64, type, originalSize, dimensions }`
- `notebook`: `{ cells: NotebookCell[] }`
- `pdf`: `{ pages: PageContent[] }`
- `parts`: multi-part content
- `file_unchanged`: cached flag

### `Write` (FileWriteTool)
**Input:**
- `file_path` (string, required, absolute)
- `content` (string, required)

**Result:** `{ type: 'create' | 'update', filePath, content, structuredPatch, originalFile (null for create), gitDiff? }`.
**Side effects:** writes file; LSP refresh.

### `Glob` (GlobTool)
**Input:**
- `pattern` (string, required)
- `path` (string, optional, defaults to cwd)

**Result:** `{ filenames: string[], durationMs, numFiles, truncated (cap 100) }`.

### `Grep` (GrepTool)
**Input:**
- `pattern` (string, required, regex)
- `path` (string, optional)
- `glob` (string, optional, file filter)
- `type` (string, optional, e.g. `js`, `py`)
- `output_mode` (`'content' | 'files_with_matches' | 'count'`, default `files_with_matches`)
- `-i` (boolean) — case-insensitive
- `-n` (boolean) — line numbers (content mode only)
- `-A`, `-B`, `-C` (number) — context lines (content mode only)
- `head_limit` (number, default 250)
- `offset` (number, default 0)
- `multiline` (boolean) — pattern spans newlines

**Result:** mode-dependent text + `durationMs`. `content` returns matched lines + context; `files_with_matches` returns paths; `count` returns per-file counts.

### `Agent` (AgentTool, legacy `Task`)
**Input:**
- `description` (string, required, short task title)
- `prompt` (string, required, full task instructions)
- `subagent_type` (string, optional, picks named subagent)
- `model` (`'sonnet' | 'opus' | 'haiku'`, optional)
- `isolation` (`'worktree'`, optional)
- `run_in_background` (boolean, optional)

**Result:** subagent's final assistant text.
**Side effects:** spawns full subprocess agent loop with own session.

### `Skill` (SkillTool)
**Input:**
- `skill` (string, required, skill name without leading `/`)
- `args` (string, optional)

**Result:** skill execution output (varies per skill — text or structured).
**Side effects:** invokes named skill; may run hooks, edit settings, spawn agents.

### `AskUserQuestion`
**Input:**
- `questions` (array, required) — each item: `{ header, question, multiSelect, options: [{ label, description }] }`

**Result:** user's selected option(s) as text/JSON.
**Side effects:** blocks turn until user answers.

### `EnterPlanMode`
**Input:** none (or empty `{}`).
**Result:** confirmation string.
**Side effects:** session enters plan mode (read-only behavior until ExitPlanMode).

### `ExitPlanMode` (ExitPlanModeV2Tool)
**Input:**
- `plan` (string, required, markdown plan body)

**Result:** confirmation; user accepts/rejects via permission flow.
**Side effects:** exits plan mode if approved; may trigger plan execution.

### `TodoWrite`
**Input:**
- `todos` (array, required) — each: `{ content (imperative), activeForm (present continuous), status: 'pending' | 'in_progress' | 'completed' }`

**Result:** `{ oldTodos, newTodos, verificationNudgeNeeded? }`.
**Side effects:** updates UI todo list state.

### `ToolSearch`
**Input:**
- `query` (string, required) — `"select:Name1,Name2"` for direct, or keywords
- `max_results` (number, default 5)

**Result:** matched tools' full JSONSchema definitions, returned as `<functions>` block making them callable.
**Side effects:** loads deferred tool schemas into the active turn.

### `TaskCreate`
**Input:**
- `subject` (string, required)
- `description` (string, required)
- `activeForm` (string, optional)
- `metadata` (record, optional)

**Result:** `{ task: { id, subject } }`.
**Side effects:** creates task; runs task-created hooks.

### `TaskUpdate`
**Input:**
- `id` (string, required)
- `subject`, `description`, `activeForm` (optional)
- `status` (`'pending' | 'in_progress' | 'completed'`, optional)

**Result:** updated task object.

### `TaskList`
**Input:** none.
**Result:** array of task objects.

### `TaskGet`
**Input:** `id` (string, required).
**Result:** single task object with full fields.

### `TaskOutput`
**Input:**
- `id` (string, required)
- `output` (string, required)

**Result:** confirmation.
**Side effects:** persists task output to disk.

### `TaskStop`
**Input:** `task_id` (string, required).
**Result:** success/failure confirmation.
**Side effects:** cancels running background task.

### `SendUserMessage` (BriefTool, legacy `Brief`)
**Input:**
- `message` (string, required, markdown)
- `attachments` (string[], optional, file paths)
- `status` (`'normal' | 'proactive'`, required)

**Result:** `{ message, attachments: [{ path, size, isImage, file_uuid }], sentAt? }`.
**Side effects:** delivers message to user; logs event.

### `SendMessage` (SendMessageTool)
**Input:**
- `channel_id` (string, required)
- `message` (string, required, markdown)
- `thread_ts` (string, optional)
- `reply_broadcast` (boolean, optional)

**Result:** message link string.
**Side effects:** posts to Slack/Discord (via configured MCP).

### `WebFetch`
**Input:**
- `url` (string, required)
- `prompt` (string, required, instructions for content extraction)

**Result:** `{ url, code, codeText, bytes, result (model-processed text), durationMs }`.
**Side effects:** HTTP request; runs sub-LLM call to apply prompt.

### `WebSearch`
**Input:**
- `query` (string, required)
- `allowed_domains` (string[], optional)
- `blocked_domains` (string[], optional)

**Result:** `{ query, results: [{ title, url }], durationSeconds, commentary? }`.

### `NotebookEdit`
**Input:**
- `notebook_path` (string, required, absolute, `.ipynb`)
- `new_source` (string, required)
- `cell_id` (string, optional, edit/insert anchor)
- `cell_type` (`'code' | 'markdown'`, optional)
- `edit_mode` (`'replace' | 'insert' | 'delete'`, default `replace`)

**Result:** `{ new_source, cell_id, cell_type, language, edit_mode, error?, notebook_path, original_file, updated_file }`.

### `LSP`
**Input:**
- `operation` (enum required): `goToDefinition | findReferences | hover | documentSymbol | workspaceSymbol | goToImplementation | prepareCallHierarchy | incomingCalls | outgoingCalls`
- `filePath` (string, required)
- `line` (number, required, 1-based)
- `character` (number, required, 1-based)

**Result:** operation-dependent (locations array, hover string, symbols list, etc.).

### `EnterWorktree`
**Input:**
- `name` (string, optional, alphanumeric + `-._`)
- `path` (string, optional, existing worktree to enter)

(name and path are mutually exclusive)

**Result:** `{ worktreePath, worktreeBranch?, message }`.
**Side effects:** creates/enters git worktree; changes cwd; resets system prompt and memory caches.

### `ExitWorktree`
**Input:**
- `action` (`'keep' | 'remove'`, required)
- `discard_changes` (boolean, optional)

**Result:** confirmation.
**Side effects:** restores original cwd; optionally deletes worktree+branch; kills associated tmux session.

### `RemoteTrigger`
**Input:**
- `action` (`'list' | 'get' | 'create' | 'update' | 'run'`, required)
- `trigger_id` (string `^[\w-]+$`, required for get/update/run)
- `body` (record, optional, for create/update)

**Result:** `{ status (HTTP code), json (stringified body) }`.
**Side effects:** authenticated API calls to remote trigger service.

### `ScheduleWakeup` (added post-leak; verified in v2.1.118 binary)
Powers the `/loop` skill's dynamic-pacing mode. Exported as `ScheduleWakeupTool`,
constants in module containing `SCHEDULE_WAKEUP_TOOL_NAME`, registered in the
default toolset alongside `CronCreateTool`, `MonitorTool`, etc.

**Input** (Zod `strictObject`):
- `delaySeconds` (number, required) — *"Seconds from now to wake up. Clamped to [60, 3600] by the runtime."*
- `reason` (string, required) — *"One short sentence explaining the chosen delay. Goes to telemetry and is shown to the user. Be specific."*
- `prompt` (string, required) — `/loop` input to fire on wake-up. Pass the same input verbatim each turn to continue the loop. For autonomous loops, pass the literal sentinel `<<autonomous-loop-dynamic>>` (the runtime resolves it back to autonomous-loop instructions at fire time).

**Sentinels** (also exported from same module):
- `AUTONOMOUS_LOOP_SENTINEL = "<<autonomous-loop>>"` — for CronCreate-based autonomous loops
- `AUTONOMOUS_LOOP_DYNAMIC_SENTINEL = "<<autonomous-loop-dynamic>>"` — for ScheduleWakeup-based dynamic loops

**Description**: *"Schedule when to resume work in /loop dynamic mode (always pass the `prompt` arg). Call before ending the turn to keep the loop alive; omit the call to end it."*

**Result:** confirmation that wakeup is scheduled.
**Side effects:** schedules dynamic loop resumption; preserves prompt cache window if delay < 300s.

**Note:** This tool is also referenced in Bash tool's GitHub rate-limit `<system-reminder>`: *"If polling in a loop, use ScheduleWakeup instead of retrying."*

### `CronCreate`
**Input:**
- `cron` (string, required, 5-field cron expression `M H DoM Mon DoW`)
- `prompt` (string, required, prompt to enqueue at fire time)
- `recurring` (boolean, default true)
- `durable` (boolean, default false, persist across sessions)

**Result:** `{ id, humanSchedule, recurring, durable? }`.
**Side effects:** registers cron job in memory or persistent file.

### `CronDelete`
**Input:** `id` (string, required).
**Result:** confirmation.

### `CronList`
**Input:** none.
**Result:** array of `{ id, cron, prompt, recurring, durable, nextRun, ... }`.

### `Config`
**Input:**
- `setting` (string, required, key e.g. `"theme"`, `"model"`)
- `value` (string | boolean | number, optional, omit to read)

**Result:** `{ success, operation: 'get' | 'set', setting, value, previousValue, newValue, error? }`.

### `ReadMcpResourceTool`
**Input:**
- `server` (string, required)
- `uri` (string, required)

**Result:** resource content as string.

### `ListMcpResourcesTool`
**Input:**
- `server` (string, optional, filter)

**Result:** `[{ name, description, uri, server }, ...]`.

### `mcp__<server>__authenticate` (McpAuthTool, dynamic)
**Input:** none.
**Result:** OAuth authorization URL (user must complete in browser).
**Side effects:** initiates OAuth flow.

### `REPL` (REPLTool, ant-only)
**Input:**
- `code` (string, required, JS to evaluate)

**Result:** stdout / return value / error from VM.
**Side effects:** evaluates arbitrary JS in REPL VM context.

### `PowerShell`
**Input:**
- `command` (string, required)
- `description` (string, optional)
- `timeout` (number, optional)

**Result:** stdout/stderr text.
**Side effects:** spawns PowerShell process.

### `TeamCreate`
**Input:**
- `name` (string, required)
- `description` (string, required)
- `members` (array, required, each `{ name, role, prompt }`)

**Result:** `{ teamId, name, members }`.
**Side effects:** spawns coordinated multi-agent team.

### `TeamDelete`
**Input:** `team_id` (string, required).
**Result:** confirmation.
**Side effects:** terminates team agents.

### `Sleep`
**Input:**
- `duration_ms` (number, required)
- `reason` (string, optional)

**Result:** confirmation after sleep.
**Side effects:** blocks turn for the duration.

### `StructuredOutput` (SyntheticOutputTool)
**Input:** structured output object (free-form, depends on schema injected by caller).
**Result:** echoes input.
**Side effects:** none — synthetic; used for downstream classifier processing.

### `mcp__<server>__<tool>` (MCPTool, dynamic)
**Input:** server-defined per tool.
**Result:** server-defined per tool.
**Side effects:** depends on MCP tool — anything from filesystem mutation to remote API calls.

### `Advisor` (AdvisorTool, added post-leak)
Server-side helper tool. Not user-callable; runs an "advisor" model alongside
the main model to suggest course corrections.

**Input:** N/A — server-side only.
**Result:** advisor-model output injected into the main model's context.
**Activation:** only enabled when base model is `opus-4-7`, `opus-4-6`, or `sonnet-4-6`. Verified in binary via log strings:
- `[AdvisorTool] Skipping advisor - base model X does not support advisor`
- `[AdvisorTool] Skipping advisor - X is not a valid advisor model`
- `[AdvisorTool] Server-side tool enabled with X as the advisor model`

### `Teammate` (TeammateTool, added post-leak)
Agent-swarm peer tool. Reads team config files (e.g. `<teamId>/config.json`)
and lets agents communicate as `@<agentName>`.

**Input:** message and target identity (specific schema not extracted; mangled in binary).
**Result:** message delivery confirmation; UI renders as `@<agentName>` Teammate label.
**Activation:** likely gated by `isAgentSwarmsEnabled()` (same as `TeamCreate`/`TeamDelete`).

---

## Web-Harness-Injected Tools — Data Model

These are NOT in the CLI binary. Only emitted by the claude.ai web app
harness above the SDK protocol. Mainframe won't see these.

### `mcp__claude_ai_*__*` (claude.ai web harness)
Dynamic per-integration (Gmail, Calendar, Drive, Notion, Slack, etc.).
Schemas defined server-side by claude.ai; not part of the CLI.

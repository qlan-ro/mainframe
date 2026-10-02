# Codex activity grouping, inspected from the installed app

## Scope and evidence

The user supplied two Codex screenshots while reviewing todo #371 and asked for the actual grouping implementation. This inspection reads the installed renderer, not the CLI and not a reconstruction from screenshots.

- Application: `/Applications/ChatGPT.app`, bundle identifier `com.openai.codex`, version `26.924.22138`.
- Source: `Contents/Resources/app.asar`. Selected renderer modules were copied and formatted under `/tmp/codex-activity-research-20261003/`.
- Source maps are referenced by the bundles but absent from the archive. Function names below are minified names; line numbers belong to formatted copies.
- No installed files, profile data, credentials or conversations were changed or read. No live UI interaction was performed.
- Eighteen checks executed the exact isolated collapse/final-answer predicates in a Node VM and passed. This verifies those predicates, not the whole React application.

Local evidence: [provenance](/tmp/codex-activity-research-20261003/provenance.json), [predicate checks](/tmp/codex-activity-research-20261003/outer-policy-tests.json), [detailed inner-group analysis](/tmp/codex-activity-research-20261003/inner-grouping-findings.md). These are local research artifacts, not portable repository files.

## The hierarchy

Codex combines two independent disclosures:

1. An activity group summarizes a consecutive run of mixed tools. Its collapsed header shows current activity while active, then a category summary such as “Read files, ran commands”. Expanding it reveals ordered details.
2. A turn disclosure folds the work section, including intermediate commentary and the inner activity groups. The final answer is rendered separately. Its header is normally “Worked for <duration>”.

This is **not a strict single activity row for the entire running turn**. Commentary and standalone events can divide activity into several groups. Compaction can remain its own row, as in the screenshots. The outer disclosure hides that accumulated work when the final answer starts.

Source: [group construction, M](/tmp/codex-activity-research-20261003/readable/agent-activity-units-94772c5b3ee6.js:370), [turn partition, vE](/tmp/codex-activity-research-20261003/readable/conversation-blocks-1768e325fd75.js:22636), [local turn composition](/tmp/codex-activity-research-20261003/readable/local-conversation-turn-1168b77e6f00.js:5335).

## Inner activity groups

### Membership and boundaries

Exec commands, file patches, ordinary MCP calls, nonempty web searches and supported dynamic tools can share a group. Grouping is not restricted to the same tool kind or successful calls. Shell commands and structured reads can coexist in the same group.

Ordinary standalone items terminate a run. These include assistant commentary, compaction, errors, image views and subagent activity. Internal reasoning is usually hidden by this mapper and therefore does not necessarily split a group. Explicit group-start markers also create boundaries. Some callers allow grouping across subagent activity.

MCP apps/widgets remain standalone. Dynamic tools supply explicit presentation flags for hidden, standalone, persistent and summary-only behavior. A declined command or patch with a denied automatic review is standalone; there is no universal rule that all failed calls remain outside groups.

Source: [item classification, an](/tmp/codex-activity-research-20261003/readable/agent-activity-item-cc5ea956670d.js:1022), [group construction](/tmp/codex-activity-research-20261003/readable/agent-activity-units-94772c5b3ee6.js:370), [automatic denial predicate](/tmp/codex-activity-research-20261003/readable/app-primary-cca0c1a58f0f.js:136968).

### Active header

Only the latest visible group gets an active header, and only while its header is in progress and its activity slice is open. Earlier groups use completed summaries.

Within that latest group, the selection order is:

1. Prefer the exploration candidate when exploration mode is active.
2. Otherwise scan backward for a running item. Automatic review uses “Thinking”; other items use their activity label.
3. With no candidate, show “Thinking”.

The exploration scan can retain the latest completed read/search/list label while the turn continues. This is not simply “always display the last tool call”. Running predicates are specific to each item type.

Active labels include a read target, search folder/query, directory listing, editing files, web-search title or MCP presentation. General commands show “Running command” in prose detail mode and can show the command in technical detail mode.

Source: [header selection, qe and Je](/tmp/codex-activity-research-20261003/readable/agent-activity-units-94772c5b3ee6.js:1067), [labels](/tmp/codex-activity-research-20261003/readable/active-tool-activity-label-20de4e4e8885.js:119).

Active/thinking identity changes wait until at least 1,000 ms since the last displayed identity change. Same-identity text updates are immediate. A completed-summary transition is immediate. This reduces rapid label changes; it is separate from tool execution timing.

Source: [header transition, Cv](/tmp/codex-activity-research-20261003/readable/conversation-blocks-1768e325fd75.js:7182), [1,000 ms constant](/tmp/codex-activity-research-20261003/readable/conversation-blocks-1768e325fd75.js:7255).

### Completed summary

The summary is deterministic aggregation, not model-generated prose. Its category order is fixed: named integrations, loaded tool definitions, unnamed calls, file changes, exploration, visualizations, commands, web searches, then dedicated dynamic-tool labels.

“Read files” covers `read`, `search` and `list_files`. It can therefore appear for a search/list-only group. Read paths are deduplicated internally, but this header does not print a file count. Counts select singular/plural for categories such as commands, without printing the number: “ran a command” versus “ran commands”. A single titled web search can use its title directly. An empty summary falls back to “Worked”.

Source: [aggregation, Ae](/tmp/codex-activity-research-20261003/readable/agent-activity-units-94772c5b3ee6.js:457), [summary wording](/tmp/codex-activity-research-20261003/readable/conversation-blocks-1768e325fd75.js:6828).

### Expansion and nesting

The aggregate group starts collapsed. Its disclosure state is component-local, with opening/closing animation states. Completion does not reset it while the same keyed component remains mounted; a remount starts fresh. Details render lazily in a scrollable `max-h-56` container, in source order.

Unfinished ordinary reads, searches and listings are filtered out of the expanded detail rows even though the header can name the active operation. A group with no remaining details, or only summary-only dynamic tools, has no disclosure.

A further nested summary can combine consecutive identical successful completed MCP calls, subject to strict metadata/presentation matching. It does not apply to arbitrary shell commands.

Source: [disclosure, yv](/tmp/codex-activity-research-20261003/readable/conversation-blocks-1768e325fd75.js:6986), [details](/tmp/codex-activity-research-20261003/readable/conversation-blocks-1768e325fd75.js:21792), [detail filter, dE](/tmp/codex-activity-research-20261003/readable/conversation-blocks-1768e325fd75.js:22600), [repeated MCP grouping](/tmp/codex-activity-research-20261003/readable/agent-activity-units-94772c5b3ee6.js:1027).

## Outer turn disclosure

### When it collapses

The shared predicate permits collapse when a final assistant answer has started, the turn was not cancelled, and renderable work exists. Default state is collapsed unless auto-collapse is prevented. An explicit user choice overrides that default; force-expanded overrides the collapsed state.

The local Codex final-answer predicate requires `phase === final_answer`, excludes asynchronous delivery and asynchronous user-input requests, and requires nonempty text, completion, or structured output. Consequently, first final-answer text can trigger collapse while that answer is still streaming.

Additional rendering guards suppress the disclosure when collapse is disabled, no collapsible content exists, or compaction is the only collapsible unit. Full-transcript and certain voice presentations disable outer folding.

Source: [collapse predicate, EE](/tmp/codex-activity-research-20261003/readable/conversation-blocks-1768e325fd75.js:22792), [content guards](/tmp/codex-activity-research-20261003/readable/conversation-blocks-1768e325fd75.js:22910), [final-answer predicate, OVn](/tmp/codex-activity-research-20261003/readable/app-shared-36eae88777f2.js:201884), [caller flags](/tmp/codex-activity-research-20261003/readable/local-conversation-turn-1168b77e6f00.js:5343).

For the local route, an explicitly expanded command can mark that turn to prevent default auto-collapse. Active background-agent rows also prevent default collapse. These are separate from explicitly toggling the outer disclosure.

Source: [command expansion](/tmp/codex-activity-research-20261003/readable/conversation-blocks-1768e325fd75.js:9637), [turn marker](/tmp/codex-activity-research-20261003/readable/app-initial-d817715f10a0.js:221929), [active subagent predicate](/tmp/codex-activity-research-20261003/readable/local-conversation-turn-1168b77e6f00.js:5705).

### What remains outside

The final answer is separate from the work units. Within the work section, specially marked persistent dynamic tools, configured MCP apps, and user steering/hook-feedback messages can remain visible even when collapsed. Leading realtime-transcript content has its own pre-disclosure position. The `worked-for` item is removed from the body and supplies the disclosure label.

Denied automatic actions can add a count beside the outer header. Clicking that count expands the work and scrolls to denial details. Ordinary tool failures are not universally persistent under this partition.

Source: [partition and persistence, vE/yE](/tmp/codex-activity-research-20261003/readable/conversation-blocks-1768e325fd75.js:22636), [denial badge](/tmp/codex-activity-research-20261003/readable/collapsed-turn-disclosure-74330d6188b4.js:151), [expand and scroll](/tmp/codex-activity-research-20261003/readable/conversation-blocks-1768e325fd75.js:23069).

### Timing and labels

A supplied `worked-for` item takes precedence. Otherwise the header uses the supplied worked duration; with neither, it shows “N previous messages”, rather than inventing a duration.

For a `worked-for` item, elapsed time is `max((completedAtMs ?? currentTime) - startedAtMs, 0)`. The live clock updates once per second. Before one second it reads “Working”; afterward, “Working for <time>”. Terminal labels are “Worked for <time>” and “You stopped after <time>”. These are work intervals, not sums of individual tool durations.

Source: [label precedence](/tmp/codex-activity-research-20261003/readable/collapsed-turn-disclosure-74330d6188b4.js:27), [status labels](/tmp/codex-activity-research-20261003/readable/app-primary-cca0c1a58f0f.js:143358), [elapsed calculation](/tmp/codex-activity-research-20261003/readable/app-primary-cca0c1a58f0f.js:143534).

## Local Codex versus ChatGPT Work

The installed app contains both routes sharing these primitives. Do not treat caller differences as one universal policy.

| Rule                        | Local Codex                                            | ChatGPT Work                                        |
| --------------------------- | ------------------------------------------------------ | --------------------------------------------------- |
| Completed single-tool group | Normally becomes standalone, with exceptions           | Explicitly preserves single-item groups             |
| Across subagent activity    | Caller-dependent                                       | Enabled after completion                            |
| Outer final trigger         | Recognized final answer; extra background-agent case   | Final answer started or work completed              |
| Inner slice closed          | Derived from assistant/turn state and user interaction | Work complete or active reasoning status present    |
| Outer state                 | Accepts externally supplied collapsed state            | This caller uses the shared component's local state |

Source: [single-item conversion](/tmp/codex-activity-research-20261003/readable/agent-activity-units-94772c5b3ee6.js:1056), [local caller](/tmp/codex-activity-research-20261003/readable/local-conversation-turn-1168b77e6f00.js:5301), [Work caller](/tmp/codex-activity-research-20261003/readable/chatgpt-conversation-turn-content-61af433b22db.js:23723).

The screenshots alone do not establish which route generated them. Both confirm the same hierarchy, while exact exceptions depend on the route and feature flags. Restart persistence and upstream timestamp generation were not traced fully.

## Consolidated delivery in Mainframe #384

The existing #371 design differs materially: it keeps all steps visible, merges only successful same-kind calls, always separates shell calls, and lets thinking split a run. Its specification explicitly excluded latest-step-only display and deferred the outer turn fold.

The user consolidated this revision and #374’s outer disclosure into active #384 after #371 merged in PR #746. Deliver mixed activity groups with a stable active summary and nested existing tool details, plus a separate outer work disclosure that leaves the final answer visible. Preserve commentary boundaries rather than assuming one global live row. Define explicit final-answer and turn identity before folding across assistant messages; Codex already has those inputs. The #384 implementation plan owns the provider contract and conservative missing-metadata behavior.

Mainframe's existing requirements about visible permissions, failures, subagents, scrolling and disclosure persistence must be reconciled deliberately with the observed Codex rules. They are product choices, not facts that can be attributed to Codex. No grouping implementation was changed during this research.

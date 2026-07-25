# Classification reference

How to turn a fetched delta (`fetch-delta.mjs` output) into a triage report.
The checklists in `docs/adapters/*/CONSUMED-SURFACE.md` are authoritative;
everything here is procedure for reading a changelog entry against them.

## Relevance filter — applied first, drop by default

An entry is relevant only if it touches a checklist row's surface:

- headless / `--print` / stream-json behaviour, or a CLI flag Mainframe passes
- app-server or JSON-RPC methods, notifications, or request/response shapes
- session, rollout, or state files on disk (`~/.claude/**`, `~/.codex/**`)
- approvals, permissions, trust, or control requests
- model catalogs, deprecations, or model-capability fields
- context/token accounting, quota, or rate limits
- a new upstream capability Mainframe could surface (adoption)

Everything else is dropped without being listed: TUI-only changes (keybinds,
themes, spinners, pane layout), IDE-extension and editor-plugin entries,
Windows-only fixes, telemetry/analytics, docs and install tooling, and
internal refactors with no stated behaviour change. The drop rule is named so
two runs over the same range agree: **drop unless the entry names a surface
in the lists above or plausibly renames/removes one a checklist row cites.**
When in doubt, keep the entry and classify it — a false keep costs a minute,
a false drop costs a silent break.

## Risk vs opportunity

- **Compatibility risk** — an existing checklist row's assumption may no
  longer hold: a renamed, added, or removed field; a changed default; a
  deprecated flag or method; a new event or version that replaces one
  Mainframe parses. Map it to the row it threatens.
- **Adoption opportunity** — a new upstream capability with no row yet,
  including anything in the Codex explicitly-ignored notification set
  (CODEX-EVT-02/03) or the Claude "Not consumed" list. Name where it would
  land and a rough size (small: one handler; medium: new UI affordance;
  large: new subsystem).

An entry can be both (a new event that *replaces* one Mainframe reads is a
risk on the old row and an opportunity on the new shape). List it under risk
and note the opportunity inline.

## Severity

- **high** — silent data loss or a parse that fails closed: the change lands,
  nothing errors, a feature quietly stops (the `tokenUsage` precedent).
- **medium** — degraded rendering or a feature that visibly misbehaves but
  the session keeps working.
- **low** — cosmetic; wrong label, formatting, ordering.

## Routing table (keyword → checklist ID prefix)

A starting point, not a substitute for reading the checklist rows.

| Entry mentions | Look at |
| --- | --- |
| stream-json, `--print`, headless, SDK | `CLAUDE-EVT-*`, `CLAUDE-FLAG-*` |
| control request, permission, hook, trust | `CLAUDE-CTRL-*`, `CLAUDE-IO-01` |
| app-server, JSON-RPC, thread/turn methods | `CODEX-RPC-*`, `CODEX-EVT-*` |
| rollout, session file, resume, fork | `CLAUDE-FILE-*`, `CODEX-FILE-*` |
| token usage, context window, compaction | `CODEX-EVT-04`, `CLAUDE-CTRL-02` |
| usage, rate limit, `/usage`, weekly limit | `CLAUDE-PROBE-03`, `CODEX-EVT-06` |
| model, deprecation, catalog | `CLAUDE-PROBE-02`, `CODEX-PROBE-02` |
| item types, tool calls, approvals | `CODEX-ITEM-01`, `CODEX-CTRL-01` |

## Worked examples

Two real changes, classified end to end, to set the bar. **Do not add the
Codex `thread/tokenUsage/updated` change as a worked example.** It is the
entry the validation replay (`VALIDATION.md`) tests against; a classifier
that only recalls its own reference doc would pass the sole regression gate
while proving nothing. Anyone editing this file must preserve that.

**Claude CLI 2.1.118 — subagent link moved.** Entry: "Task tool results now
carry the agent id in `toolUseResult.agentId`" (previously `parentToolUseID`).
Relevant: touches the JSONL session format. Risk, **medium**: maps to
`CLAUDE-FILE-04` (`src/history_subagents.rs::capture_agent_id_mapping`).
Symptom: resumed chats lose subagent output — messages render, but subagent
blocks orphan instead of nesting under the parent Task tool_use.
Regression test: extend the row's Coverage test
(`capture_agent_id_mapping_links_agent_to_tool_use`) with a fixture using the
new field only. Verify live via `.claude/skills/claude-protocol-debugger/`.

**Codex — state DB schema bump.** Hypothetical entry: "migrate session state
to `state_6.sqlite`". Relevant: on-disk state file. Risk, **high**: maps to
`CODEX-FILE-02` (`src/thread_registry.rs::lookup_agent_metadata` hardcodes
`state_5.sqlite`). Symptom: silent — the query targets a file the CLI no
longer writes, so sub-agent nickname/role lookups return nothing and external
Codex sessions lose metadata with no error. Regression test: new `#[test]` in
`tests/` pinning the filename the registry opens against a temp `~/.codex`.
Verify live via `.claude/skills/codex-protocol-debugger/`.

## What counts as a recommended regression test

It must name a Rust unit or integration test in
`packages/core-rs/crates/mainframe-adapter-{claude,codex}/` — either extend
the row's existing Coverage test, or state the new `#[test]` fn and the file
it goes in, plus the payload to pin (the Codex crate has no fixture
directory; tests build payloads inline). Playwright specs and
`packages/e2e/fixtures/recordings/` are **not** acceptable: they replay
Mainframe's own adapter API, so they keep passing after an upstream
wire-shape break — exactly the failure the `tokenUsage` precedent
demonstrates. Prefer a test that asserts the deserialized *value*, not just
that parsing returned `Ok`; the `tokenUsage` regression hid inside an
`if let Ok(..)`.

## Report template

Write to `reports/<ISO-date>-<tool>-report.md` (gitignored):

```markdown
# changelog-watch: <tool> <from> → <to> (<date>)

Entries seen: N · classified relevant: N · dropped as irrelevant: N

## Compatibility risks

### <severity> — <entry text, verbatim> (<version or tag>)

- Checklist row: <ID> — <consumer file::symbol>
- Why it threatens the row: <one or two sentences>
- Recommended regression test: <extend <test> / add #[test] <fn> in <file>, pinning <payload>>
- Verify live: .claude/skills/<tool>-protocol-debugger/

## Adoption opportunities

- <capability> — would land in <where>; size: <small|medium|large>

## No relevant changes

<Only when the delta survives the filter empty: say so and stop.>
```

Every delta entry must end up either mapped to a checklist ID above or
counted in the dropped total — an unclassified entry means the run is not
finished.

## Todo draft template

One draft per compatibility risk, filed per `docs/agents/issue-tracker.md`
(`labels = ["needs-triage"]`, `status` left at its default `open`):

```
title: <tool>: <surface> — <one-clause risk>
body:
  Upstream: <entry text, verbatim> (<version/tag>, <link if the delta has one>)
  Checklist row: <ID> — <consumer file::symbol>
  Risk: <severity> — <symptom>
  Recommended regression test: <as in the report>
  Verify first: .claude/skills/<tool>-protocol-debugger/
```

Filing is always a separate, explicit action — never automatic.

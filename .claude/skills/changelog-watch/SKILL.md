---
name: changelog-watch
description: Use when checking whether new Claude Code or Codex releases affect Mainframe's adapters, or when auditing adapter drift after a CLI upgrade. Fetches the upstream delta since the last reviewed version, classifies every entry against the consumed-surface checklists, and produces a triage report separating compatibility risks from adoption opportunities.
---

# Changelog Watch

One question per run: what changed upstream since Mainframe last looked, and
what does it mean for the adapters? All paths below are relative to the repo
root. Analysis only — never fix drift in the same run; findings become todos.

## Steps

1. **Read `.claude/skills/changelog-watch/state.json`.** Pick the tool(s) to
   run — `claude`, `codex`, or both. `lastReviewedVersion` is the anchor:
   entries up to and including it are already triaged.

2. **Fetch the delta.** Per tool:

   ```bash
   node .claude/skills/changelog-watch/scripts/fetch-delta.mjs --tool claude
   node .claude/skills/changelog-watch/scripts/fetch-delta.mjs --tool codex
   ```

   Done when a delta file exists under
   `.claude/skills/changelog-watch/reports/`, **or** the CLI printed
   `no changes: <tool> is current at <version>` — in which case stop here and
   report exactly that. Add `--json` to read the current upstream head and
   the truncation fields (`head`, `truncated`, `nextAnchor`) without parsing
   the human output — useful for answering "what is upstream at right now"
   without writing a delta.

3. **Load the tool's checklist** — `docs/adapters/claude/CONSUMED-SURFACE.md`
   or `docs/adapters/codex/CONSUMED-SURFACE.md` (schema in
   `docs/adapters/README.md`). Done when every checklist ID is in context.

4. **Classify every delta entry** per
   `.claude/skills/changelog-watch/classification.md`: relevance filter
   first (drop by default), then risk vs opportunity, severity, and the
   routing table. Done when **every** entry is either mapped to a checklist
   ID or explicitly dropped, and the dropped count is recorded. An
   unclassified entry means this step is not finished.

5. **Write the report** to
   `.claude/skills/changelog-watch/reports/<ISO-date>-<tool>-report.md`
   using the template in `classification.md`, and print the summary: risks
   (each naming its checklist ID, Rust consumer, and recommended regression
   test), opportunities, dropped count.

6. **Advance state — only after the report exists.** Rerun the fetch with
   `--commit-state <newest-version-reviewed>`, then commit `state.json`.
   Never advance state for entries that were fetched but not classified.

7. **Offer the todo drafts** (template in `classification.md`) for filing
   per `docs/agents/issue-tracker.md`. Filing is a separate, explicit
   action — never automatic.

## Range too wide

Claude ships roughly a release a day; a stale anchor can mean dozens of
versions. Walk forward in passes instead of classifying everything at once:

```bash
node .claude/skills/changelog-watch/scripts/fetch-delta.mjs --tool claude --max 5
```

`--max` returns the **oldest** unreviewed versions first and prints
`nextAnchor` plus the exact command to continue. Classify the pass, report,
`--commit-state` the pass's newest version, repeat. Each pass leaves state
consistent, so an interrupted walk never skips entries.

## Verifying a suspected change

The report classifies changelog prose; it does not prove runtime behaviour.
Before acting on a `high` risk, confirm it against the live CLI with
`.claude/skills/claude-protocol-debugger/` or
`.claude/skills/codex-protocol-debugger/`.

## Adding a tool

A new `tools` entry in `state.json` (repo, `mode: changelog|releases`,
`tagPrefix`, seed anchor) plus a `docs/adapters/<tool>/CONSUMED-SURFACE.md`
checklist. No code change, provided the repo publishes either a changelog
file or GitHub releases.

## Failure modes

- `unknown anchor: <version>` — the anchor is not in the fetched
  changelog/releases (upstream rewrote history, or a typo in `--since`).
  Investigate; never work around it by picking "everything".
- `gh` missing — the fetcher falls back to anonymous HTTPS; if both fail it
  exits non-zero. An empty delta is only trusted when the CLI says
  `no changes`, never when a fetch failed.

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
   run — `claude`, `codex`, or both. `lastReviewedRef` is the anchor: entries
   up to and including it are already triaged. It is whatever the upstream
   list calls that entry — a bare version in changelog mode, a release tag in
   releases mode — and is never parsed, only matched.

2. **Fetch the delta.** Per tool:

   ```bash
   node .claude/skills/changelog-watch/scripts/fetch-delta.mjs --tool claude
   node .claude/skills/changelog-watch/scripts/fetch-delta.mjs --tool codex
   ```

   Done when the CLI names the delta file it wrote under
   `.claude/skills/changelog-watch/reports/`, **or** it printed
   `no changes: <tool> is current at <ref>` — in which case stop here and
   report exactly that. `--json` swaps the human summary for the same result
   as fields (`head`, `count`, `truncated`, `nextAnchor`, `out`); it does not
   suppress the delta file, which is written whenever the delta is non-empty.
   The fetcher refuses to overwrite an existing delta file — pass a different
   `--out`, or `--force` to replace it.

3. **Load the tool's checklist** — `docs/research/adapters/claude/CONSUMED-SURFACE.md`
   or `docs/research/adapters/codex/CONSUMED-SURFACE.md` (schema in
   `docs/research/adapters/README.md`). Done when every checklist ID is in context.

4. **Classify every delta entry** per
   `.claude/skills/changelog-watch/classification.md`: relevance filter
   first (drop by default), then risk vs opportunity, severity, and the
   routing table. Done when **every** entry is either mapped to a checklist
   ID or explicitly dropped, and the dropped count is recorded. An
   unclassified entry means this step is not finished.

5. **Write the report** to
   `.claude/skills/changelog-watch/reports/<ISO-date>-<tool>-since-<anchor>-report.md`
   using the template in `classification.md` — the anchor in the name keeps a
   second pass on the same day from overwriting the first. Print the summary:
   risks (each naming its checklist ID, Rust consumer, and recommended
   regression test), opportunities, relevant-no-action entries, dropped count.

6. **Advance state — only after the report exists.** Rerun the same fetch,
   adding `--commit-state <newest entry reviewed>` and the `--out` path the
   pass wrote, then commit `state.json`:

   ```bash
   node .claude/skills/changelog-watch/scripts/fetch-delta.mjs --tool claude \
     --since 2.1.176 --max 5 --out <pass delta> --commit-state 2.1.181
   ```

   The ref must be one the refetched delta contains, and that delta file must
   still be on disk, or the CLI refuses: state may only walk over entries a
   run actually fetched and reported. Committing the current anchor is the
   allowed no-op — it records "checked, nothing new".

7. **Offer the todo drafts** (template in `classification.md`) for filing
   per `docs/guides/issue-tracker.md`. Filing is a separate, explicit
   action — never automatic.

## Range too wide

Claude ships roughly a release a day; a stale anchor can mean dozens of
versions. Walk forward in passes instead of classifying everything at once:

```bash
node .claude/skills/changelog-watch/scripts/fetch-delta.mjs --tool claude --max 5
```

`--max` returns the **oldest** unreviewed versions first and prints
`nextAnchor` plus the exact command to continue, `--out` included. Classify
the pass, report, `--commit-state` the pass's newest version, repeat. Each
pass leaves state consistent, so an interrupted walk never skips entries.

Give every pass its own `--out`: the default path carries the pass's anchor
for that reason, and `reports/` is gitignored, so a delta overwritten by the
next pass is gone.

## Verifying a suspected change

The report classifies changelog prose; it does not prove runtime behaviour.
Before acting on a `high` risk, confirm it against the live CLI with
`.claude/skills/claude-protocol-debugger/` or
`.claude/skills/codex-protocol-debugger/`.

## Adding a tool

A new `tools` entry in `state.json` (`repo`, `mode: changelog|releases`,
`changelogPath` or `includePrerelease`, seed `lastReviewedRef`) plus a
`docs/research/adapters/<tool>/CONSUMED-SURFACE.md` checklist. No code change,
provided the repo publishes either a changelog file or GitHub releases.

## Failure modes

- `unknown anchor: <ref> — absent from the complete upstream list` — the ref
  is genuinely gone (upstream rewrote history) or is a typo in `--since`.
  Investigate; never work around it by picking "everything".
- `unknown anchor: <ref> — absent from the N newest releases fetched` — the
  walk stopped before reaching it. The releases fetch pages until it sees the
  anchor, so this means the anchor is older than the page cap; raise the cap
  in `fetch-delta.mjs` rather than reseeding state, which would skip
  everything in between.
- `gh` missing — the fetcher falls back to anonymous HTTPS per page; if both
  fail it exits non-zero. An empty delta is only trusted when the CLI says
  `no changes`, never when a fetch failed. Transient `gh` 5xx and stream
  errors surface verbatim; rerun.

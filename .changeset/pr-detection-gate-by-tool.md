---
'@qlan-ro/mainframe-core': patch
---

fix(core/claude): gate PR-URL detection on the originating tool

Path A (URL scrape) used to run on every `tool_result` block, so any chat
that read or grepped a file containing a PR URL would get falsely tagged
with that PR. Path A is now restricted to:

- `Bash` whose command matches `gh pr` / `glab mr` / `az repos pr`, or
- `Agent` / `Task` (subagent) tool_results — whose `content` is an array
  of typed blocks rather than a string, now flattened so a PR URL in the
  subagent's final report is actually detected.

This fixes both the false positives (PR badges from `Read`/`Grep`/`cat`)
and the false negative where a session that opened a PR via an
`azure-devops` subagent never registered its own PR.

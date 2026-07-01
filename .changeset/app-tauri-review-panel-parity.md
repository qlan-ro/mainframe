---
"@qlan-ro/mainframe-ui": minor
"@qlan-ro/mainframe-core": minor
"@qlan-ro/mainframe-types": minor
---

Bring the Review Changes panel to design parity. The panel is now the
three-column PR-style surface from the prototype: a "Changed files" list with
status badges and +/- stat meters, a per-file toolbar ("Open in workspace" and
a "Viewed" toggle), and a "Commit" rail (summary, suggestion chips, unviewed
warning, "Commit N files", and a committed success state) — wiring in the
previously-orphaned `ReviewCommitRail`/`ReviewFileToolbar`. The header gains the
diff glyph, branch chip, `N files · +X −Y` totals, and a viewed counter. The
diff body keeps the side-by-side editor and its inline comment-to-agent form
alongside the new commit flow.

Adds the supporting daemon data layer: `GitService.commitAll` +
`POST /api/projects/:id/git/commit` (stage-all and commit), and
`GitService.workingStat` + `GET /api/projects/:id/git/working-stat` (per-file
addition/deletion counts, with line-counting for untracked files), surfaced to
the UI via the new `WorkingStat` type and the `gitCommit`/`getWorkingStat`
helpers.

Also hardens worktree-presence detection: a chat's `worktreeMissing` flag now
requires an actual `.git` entry, not just that the directory exists. An
orphaned worktree stub (left behind when a worktree is removed) previously
passed the bare existence check, so reads and diffs resolved to a dead path and
failed with "Path outside project"; such chats are now correctly reported as
worktree-missing.

---
'@qlan-ro/mainframe-ui': patch
'@qlan-ro/mainframe-app-tauri': patch
---

Fix the Claude adapter persisting session-scoped permission grants. It used to rewrite every permission update's destination to `.claude/settings.local.json` before echoing it back to the CLI, regardless of what the CLI itself declared — most damagingly for a permission-mode change, which landed as the project's new default mode. The adapter now forwards each update's declared destination as-is, with one added rule: a mode change is never forwarded to a persisting destination, so it can only ever apply to the running session.

The same inverted rewrite is removed from the orphaned Node daemon (`packages/core`); its `setMode` guard was not ported there, since that daemon is unshipped and kept only for its `package.json` version.

Entries this bug already wrote into `.claude/settings.local.json` — most notably a stray `defaultMode` — are not migrated or removed by this fix. If you see one you didn't set deliberately, delete it by hand.

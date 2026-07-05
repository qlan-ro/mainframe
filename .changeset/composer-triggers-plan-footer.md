---
"@qlan-ro/mainframe-ui": patch
---

Fix three composer/plan-gate bugs found in live e2e verification: the `/` and
`@` trigger popovers no longer stay open after picking a skill, file, or
agent (force-close via the same mechanism the library uses for Escape);
picking a directory under `@` no longer leaves a stale trailing space (the
fix read the composer's raw runtime state instead of a stale memoized
snapshot); and approving a plan no longer briefly resets the gate to its
pre-approval controls before the running footer appears (the retained render
no longer requires `isRunning`, closing a one-render unmount gap).

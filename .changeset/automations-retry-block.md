---
'@qlan-ro/mainframe-types': minor
'@qlan-ro/mainframe-ui': minor
---

Add a `retry` block to Automations: wrap steps that fail transiently and they run again, up to a declared number of attempts, with the run failing on the last attempt's error rather than the first.

Each attempt runs in its own frame and records its outcome, which is what makes it correct rather than merely convenient — the walk treats an already-failed step as settled, so a retry that inferred its state by replaying would skip the failed step and report success. That bookkeeping also lets a run interrupted mid-retry resume on the right attempt instead of starting over, and it stays out of the run timeline, since it is engine state rather than a step anyone wrote.

One thing the editor says plainly rather than guarding: every attempt re-runs the whole body, including steps that already had an effect. A retry around "open a PR" opens a second one. The engine's idempotence flag is internal and never reaches the editor, so a check here would half-work; the honest version is the warning next to the field.

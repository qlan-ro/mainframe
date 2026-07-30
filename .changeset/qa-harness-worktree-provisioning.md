---
---

Agent QA harness only (`.agents/`), no shipped package behavior: `test-env.sh` now
re-execs from the primary checkout so a worktree frozen on an older branch runs the
current scripts; both launch targets read the checkout's own `.env` instead of
hardcoded ports, provision the daemon sidecar when it is missing, gain a `prepare`
mode, and fail fast when the launcher dies; `up` no longer runs the fleet-wide port
sweep that killed sibling lanes mid-run.

---
'@qlan-ro/mainframe-types': minor
'@qlan-ro/mainframe-ui': minor
---

Add a `wait` step to Automations, so a run can pause for a fixed delay and carry on. It parks on the run's checkpoint rather than holding a timer, which costs nothing while waiting and survives a daemon restart — a run interrupted mid-wait resumes on schedule instead of losing the delay. Durations are set as an amount plus a unit and stored canonically in seconds, capped at seven days, since anything longer is a unit mix-up far more often than an intent.

This also fixes a latent bug it depended on: the sweep that resolves a run's `wakeAt` was never armed at boot, so `ask_agent` timeouts could not fire and a hung agent step waited forever. Arming that sweep enforces those timeouts for the first time.

---
'@qlan-ro/mainframe-types': minor
'@qlan-ro/mainframe-ui': minor
---

Automations can now run a `repeat` block's iterations concurrently. Set `concurrency` and a fan-out of agents starts together instead of one after another — the shape a review panel or a per-item agent sweep actually wants. Absent or `1` leaves the sequential path untouched.

The engine could already hold several places at once — restarting a daemon re-attaches every waiting agent, cancelling a run reaches all of them, and checkpoint writes are transactional. What it couldn't do was start the second branch: the walker stopped at the first step that had to wait, and an agent in flight is a step that has to wait. It now starts every branch before parking, and converges as each one settles.

Two supporting changes were needed to make that honest. A run's wake-up deadline used to be a single value, so two branches waiting on different deadlines would silently lose one; each waiting step now carries its own, and the run-level value became a cheap filter over them. And a branch that fails while its siblings are still running no longer ends the run underneath them — the run waits for every branch to settle before reporting, so an agent is never left working on a run the user already sees as finished.

Also fixes a bug from the preceding blocks: a step lookup didn't descend into `loop` or `retry` bodies, so an `ask_agent` inside one silently lost its `expects` output contract — the JSON was never parsed and downstream tokens resolved to nothing while the step still reported success. The same gap made `keepGoing` and restart-safety decisions read the wrong values inside those blocks.

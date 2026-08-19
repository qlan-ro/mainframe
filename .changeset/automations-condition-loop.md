---
'@qlan-ro/mainframe-types': minor
'@qlan-ro/mainframe-ui': minor
---

Add a condition loop and a `break` step to Automations. `repeat` walks a list resolved once before it starts, so it can't poll or converge; the new `loop` re-tests its condition before every pass and comes in `while` and `until` flavours, which is what "keep checking until the build is green" needs. `break` leaves the innermost loop early, from inside an `if` arm too.

Two rules are worth knowing. Before the first pass there is nothing for a condition about the loop's own body to read, so an unresolved condition there runs the pass — without that, "repeat while the build is running" would exit before running anything. And a loop must declare how many passes it may run: exhausting that ceiling fails the block rather than continuing quietly, because a poll that never went green must not read as one that did.

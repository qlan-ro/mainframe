---
"@qlan-ro/mainframe-core": patch
---

Codex history reconstruction now assigns **deterministic** display-message ids
(derived from the stable thread-item id, with a slot suffix for items that emit
more than one message) instead of a fresh `nanoid()` per pass. Because the ids no
longer change between reconstructions, the display delta emitter can detect a pure
append and send `display.message.added` / `display.message.updated` deltas, rather
than re-broadcasting the entire transcript as a `display.messages.set` on every
turn of a live Codex session. This removes per-turn full-thread re-renders on the
clients and was the churn that exposed the optimistic-send duplicate bubble.

Behavioral note for client/contract consumers (incl. mobile): a live Codex turn
now arrives as add/update deltas (as Claude already does) instead of a full set;
ids remain unique opaque strings, so this is additive — no contract reshape.

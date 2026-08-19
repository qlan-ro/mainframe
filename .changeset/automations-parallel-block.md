---
'@qlan-ro/mainframe-types': minor
'@qlan-ro/mainframe-ui': minor
---

Add a `parallel` block to Automations, and a control for running a repeat's iterations at once.

`parallel` runs branches you author separately — review this diff while drafting the release note while checking the build — rather than the same steps once per item. Branches all start before the block waits, and a failing branch doesn't cut its siblings off partway; the block reports once every branch has settled.

The concurrency setting on `repeat` shipped in the engine last release with no way to set it. It now has one, defaulting to one-at-a-time, which is what every existing automation already does.

Both carry the same caveat, stated in the editor and the guide: steps that *wait* — agents, forms, waits — genuinely overlap, while local work inside a single branch still runs one step at a time. Concurrency here is about how many chats can be outstanding, not about making commands faster.

Also fixes the read-only Details pane, which rendered nothing at all for `loop` and `retry` blocks — they were added without teaching that view they exist.

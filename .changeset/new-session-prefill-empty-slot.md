---
'@qlan-ro/mainframe-ui': patch
---

Fix "New session" on selected text and the "Run in a new session" chip silently failing (or, for the chip, throwing an error toast) whenever the new-thread slot is empty right after a draft's first send — both now wait for the switched draft to settle before initializing it, and the chip shares the toolbar's project/adapter-preserving sequence instead of duplicating it. Split view now scopes the floating selection toolbar to the zone holding the selection, so the wrong zone's toolbar no longer intercepts the click.

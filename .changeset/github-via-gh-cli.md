---
'@qlan-ro/mainframe-core': patch
'@qlan-ro/mainframe-ui': patch
---

Run the GitHub actions through the `gh` CLI instead of a hand-rolled HTTP client. `github.create_pr` and `github.list_prs` no longer ask for a token — `gh` already holds one — and `github.list_prs` now resolves `@me`, which the REST search endpoint never did. When `gh` is missing or signed out, the action catalog reports both actions unavailable and the editor mutes them with the remedy instead of offering a step that always fails.

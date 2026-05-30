---
"@qlan-ro/mainframe-desktop": patch
---

refactor(desktop): carry error message directly instead of sentinel round-trip (WS14a)

The renderer destroyed an `error` block's message into an opaque frozen text
sentinel (`\0__MF_ERROR__`) at conversion, then string-compared that sentinel at
render time and re-scanned every message via `getExternalStoreMessages` to recover
the message it had already discarded. Now `convert-message` carries `block.message`
directly in the text part, and `MainframeText` identifies an error part by checking
the current message's own blocks (no cross-message scan, no magic string). Removes
`ERROR_PLACEHOLDER` and `findErrorMessage`. The `permission_request` placeholder is
left for the broader WS14b/c grouping refactor. No behavior change.

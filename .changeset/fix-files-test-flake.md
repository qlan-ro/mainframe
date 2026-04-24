---
'@qlan-ro/mainframe-core': patch
---

Make `asyncHandler` return its wrapped Promise so tests can properly `await` route handlers. Previously the wrapper used a fire-and-forget `.catch(next)` which discarded the Promise, forcing tests to rely on a 50ms `setTimeout`-based polyfill that raced against `listFilesWithRipgrep`'s subprocess spawn and flaked under load. Server behavior is unchanged (Express ignores the handler's return value).

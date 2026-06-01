---
'@qlan-ro/mainframe-core': patch
---

Extract PR/MR URL detection out of the Claude adapter's `events.ts` into a dedicated `pr-detection.ts` module. The regexes, command matchers, and URL parsers (`parsePrUrl`, `extractPrFromToolResult`, `isPrMutationCommand`, etc.) are a self-contained concern from event dispatch and already have their own test coverage; `events.ts` now imports them back. No behavior change.

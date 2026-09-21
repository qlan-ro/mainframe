---
'@qlan-ro/mainframe-ui': patch
---

A Codex web fetch now renders in the same Web card Claude's WebFetch/WebSearch use — globe glyph, "Fetch" verb, and a clickable URL — instead of showing as a plain "Search" with no link. The card's verb and target now come from the tool call's arguments rather than a Claude-specific tool name, so a fetch's body is the URL alone (Codex sends no result text to summarize) while a search still shows its result summary once one arrives. A web call with neither a URL nor a query now renders a header-only card with a disabled trigger instead of raw JSON.

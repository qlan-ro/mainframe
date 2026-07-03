---
"@qlan-ro/mainframe-ui": patch
---

Fix Find in Path result clicks landing one line and one column past the actual
match: `FindInPathModal` now converts the daemon's 1-based search coordinates
to the 0-based `RevealTarget` contract before emitting `open-file`.

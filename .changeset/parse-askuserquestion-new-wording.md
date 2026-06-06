---
"@qlan-ro/mainframe-core": patch
---

Parse the current AskUserQuestion result wording. The Claude CLI changed its
answer echo from `User has answered your questions: …in mind.` to `Your questions
have been answered: … these answers in mind.` — the parser recognized only the old
prefix/suffix and returned no structured answers for the new one, so answered
questions rendered empty/collapsed after reload. It now accepts both wordings (the
structured `"Q"="A"` core is unchanged).

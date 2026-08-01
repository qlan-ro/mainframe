---
'@qlan-ro/mainframe-ui': patch
---

Keep long unbreakable text inside the user bubble.

A message containing a token longer than the bubble — a URL, an absolute path, a long inline-code span — used to paint past the card's border and over the transcript, because neither the user card, the queued card, nor the approved-plan card opted into word breaking. All three now break a word that cannot fit, and only such a word: ordinary messages wrap exactly where they did before. The plan card no longer sets `overflow-hidden`, which was silently clipping the same content instead of showing it.

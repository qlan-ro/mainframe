---
"@qlan-ro/mainframe-app-tauri": patch
---

Open an uncached Claude chat faster: the first transcript window now comes from the end of the transcript file, read backwards until it holds enough whole turns, instead of waiting for the whole file to parse. The full load still follows, and an ambiguous cut (other transcripts for the session, copied history, a tool result whose call is earlier) keeps the full read.

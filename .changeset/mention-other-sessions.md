---
'@qlan-ro/mainframe-ui': minor
'@qlan-ro/mainframe-types': minor
---

Reference another session from the composer with `@`.

Typing `@` in the composer now offers other sessions in the project alongside files and agents. Picking one inserts `@label`; sending the message prepends a reference line carrying the session's transcript path, and the sent message renders the mention as a chip instead of the raw path. An imported session no longer takes its sidebar title from that reference line.

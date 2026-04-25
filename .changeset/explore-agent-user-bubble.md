---
'@qlan-ro/mainframe-core': patch
---

Fix spurious empty user bubble in Explore agent / Task tool subagent threads.

Bare `<command-name>` CLI echoes (no accompanying `<command-message>` tag) are
now suppressed in `convertUserContent` instead of being synthesized into a
`/commandName` bubble. An additional guard in `convertGroupedToDisplay` drops
user messages whose display content and metadata are both empty, preventing any
residual empty bubble from reaching the client.

User-typed `/skill-name` invocations are unaffected — they always carry a
`<command-message>` tag alongside `<command-name>` and continue to render
correctly.

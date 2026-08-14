---
"@qlan-ro/mainframe-ui": patch
---

Replayed sessions now report their background work, including workflow runs. The
mock adapter derives background-task start/end from the message stream — a
`Workflow` tool use starts a workflow row and seeds its run, `Task`/`Agent` start
subagent rows, a backgrounded `Bash` starts a shell row, and a matching
`tool_result` ends whichever it was. Work a recording never resolves keeps
running. A fixture can also ship a full `ClaudeWorkflowRun` snapshot via the
`onWorkflowRun` recorded method, so the run panel's phases, agent grid, token
counts and "up next" render under replay.

Until now the Activity panel, the rail's pulse dot, `summarizeByKind` and the
whole workflow-run surface were unreachable in mock mode — they always read
"Nothing running" — which left them untestable as well as undemoable. Adds a
`workflow` fixture: a four-phase release-readiness run, six agents, two phases
still going.

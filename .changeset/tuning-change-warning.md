---
'@qlan-ro/mainframe-ui': minor
---

Warn before a model, effort, or tuning-feature change is applied to a session that already has history. The confirm names the change ("Sonnet 4.5 → Opus 5"), says the session's cached context is discarded so the next message re-sends the conversation as new input, and quotes the approximate size when the CLI has reported it. Nothing reaches the daemon until you confirm; cancelling leaves the control where it was. A chat with no messages, and a re-pick of the value already in effect, behave exactly as before, and a "Don't warn again" checkbox turns the confirm off for all three controls for good.

The model picker is now inert while the assistant is working, matching the effort and features controls, so no control can reach a running CLI mid-answer.

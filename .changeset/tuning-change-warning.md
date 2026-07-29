---
'@qlan-ro/mainframe-ui': minor
---

Warn before a model, effort, or tuning-feature change is applied to a session that already has history. The confirm names what is changing in its title, then explains that changing the model or reasoning effort invalidates the cached context, so the next message re-sends the conversation as new input and contributes to your usage or cost. It quotes the approximate size when the CLI has reported it. Nothing reaches the daemon until you confirm; cancelling leaves the control where it was. A chat with no messages, and a re-pick of the value already in effect, behave exactly as before, and a "Don't warn again" checkbox turns the confirm off for all three controls for good.

The model picker is now inert while the assistant is working, matching the effort and features controls, so no control can reach a running CLI mid-answer.

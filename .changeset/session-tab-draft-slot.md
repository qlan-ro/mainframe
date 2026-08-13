---
'@qlan-ro/mainframe-ui': patch
---

Keep a new session's tab open while it is a draft, and make it temporary once it is sent.

Creating a session used to pin its tab immediately, so every new session accumulated a permanent tab wherever the pinned set happened to end. The strip now has a third slot: an unsent draft opens into it, where opening another session cannot displace it, and the first send demotes it into the ordinary preview slot — it turns italic, grows the "Keep open" pin, and the next session you open replaces it. The draft always renders last, so a new session is the end tab. The runtime's transient boot draft is told apart from a deliberate one by whether the session list had loaded when it was activated, so booting still leaves no stray "New Session" tab.

---
'@qlan-ro/mainframe-app-tauri': patch
---

The transcript jumps to the bottom only when a message really went out: a send into a chat whose working directory is gone, an empty send, a Send now that finds nothing to send and a failed Resume no longer move the view. Retry on a "Failed to send" message now jumps to the bottom like any other send.

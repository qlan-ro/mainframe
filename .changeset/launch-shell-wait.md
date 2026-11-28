---
"@qlan-ro/mainframe-app-tauri": patch
---

The desktop window now opens straight away on launch instead of waiting up to 5 s for your login shell. The app reads your shell environment in the background and starts the daemon from the environment it saved on the previous launch, so a slow shell profile no longer delays the daemon either. If you edit a shell start-up file (`.zshrc`, `.zprofile`, `/etc/paths`, and so on), the next launch waits for a fresh read instead of using the saved one. Other changes to the environment reach the daemon on the following launch, and reach new terminals as soon as they are read.

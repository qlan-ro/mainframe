---
"@qlan-ro/mainframe-app-tauri": patch
---

The desktop window now opens straight away on launch instead of waiting up to 5 s for your login shell, and the "waiting for daemon" screen clears much sooner. The app reads your shell environment in the background and starts the daemon from the environment it saved on the previous launch. The daemon uses that environment instead of starting your shell a second time, so a slow shell profile no longer delays either of them. A daemon you start yourself (standalone or from the CLI) still reads your shell as before. Only what your shell profile adds is saved; values tied to the current login, such as your SSH agent socket, always come from the current session. If you edit a shell start-up file (`.zshrc`, `.zprofile`, `/etc/paths`, and so on), the next launch waits for a fresh read instead of using the saved one. Other changes to the environment reach the daemon on the following launch, and reach new terminals as soon as they are read.

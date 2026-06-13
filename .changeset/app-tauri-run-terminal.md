---
'@qlan-ro/mainframe-app-tauri': patch
---

Add the Run terminal surface: a Tauri-local Rust PTY (`portable-pty`) streams raw output to xterm over a per-terminal bare `Channel(InvokeResponseBody::Raw)` and exit events over a typed `Channel<ExitEvent>`; each terminal is modeled as a `RunTab{kind:'terminal'}` in the per-session Run pane layout. PTYs are killed and xterm caches disposed on tab close, pane close, and Run toggle-off; `kill_all` runs on `WindowEvent::Destroyed`. The desktop `useTerminalStore` and tool-windows terminal registration are not ported — superseded by the Run pane model.

---
"@qlan-ro/mainframe-ui": patch
---

The desktop UI now builds with the React Compiler, which memoizes components and hooks automatically so fewer of them re-render on each update. Relative times ("5m") in the session list, automation runs, archived sessions, webhook deliveries and GitHub sync now keep counting while the view sits idle.

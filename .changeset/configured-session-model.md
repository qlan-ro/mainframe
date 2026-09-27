---
"@qlan-ro/mainframe-ui": patch
---

Honor chat model choices, Mainframe provider settings, and configured CLI models in that order for Claude and Codex. Keep explicit choices across resume, resolve CLI inheritance before resuming, and show the CLI-reported model separately from the saved selection. Report rejected live switches without saving them, and preserve configured aliases or custom models missing from the catalog.

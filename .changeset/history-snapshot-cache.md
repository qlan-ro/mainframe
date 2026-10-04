---
'@qlan-ro/mainframe-ui': patch
---

Open a cold chat without re-parsing its transcript: the daemon now keeps a per-chat snapshot of the parsed history under `<data_dir>/cache/history`, fingerprinted by the transcript files' size and mtime, and serves a cold open from it when the transcript has not changed. A changed transcript, a missing file, or a corrupt snapshot falls back to the normal parse.

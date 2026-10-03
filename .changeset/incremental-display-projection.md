---
'@qlan-ro/mainframe-app-tauri': patch
---

An ordinary streaming update now costs work proportional to the active turn and the containers it touches, not to a chat's settled history length. Each chat keeps a stateful display projector that turns a raw-cache mutation plus the live partial overlay into a container-level delta, and the ACP facade hub encodes, diffs, and records only the changed containers instead of re-encoding and re-diffing the whole transcript on every partial. Full history load, an explicit transcript replacement, and resume replay are unaffected and still produce a full snapshot; the wire protocol and resume-cursor behavior are unchanged.

---
'@qlan-ro/mainframe-app-tauri': patch
'@qlan-ro/mainframe-ui': patch
---

Centre the macOS traffic lights on the sidebar header row, and move the Update pill to sit beside them. The lights sat 5px below the row's 24px midline in packaged builds: macOS 26 renders the classic button metrics for binaries linked against SDK ≤ 15 (every release build — the CI runner is macos-14), where the cluster centre lands at y + 2, while a locally built dev app links SDK 26 and centres at y − 2. Tuning by eye against a dev window therefore misaligned every release. tauri.conf.json now carries the packaged-correct y (22) and tauri:dev patches it to 26, so both builds centre on the same midline.

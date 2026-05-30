---
'@qlan-ro/mainframe-core': patch
---

Fix a data-loss quirk in `groupToolCallParts`: a task-progress tool consumed inside the explore-group look-ahead was silently dropped instead of being accumulated. The look-ahead now collects progress tools into the same `_TaskProgress` entry as the main loop, so progress updates interleaved with explore runs are no longer lost.

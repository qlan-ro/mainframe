---
"@qlan-ro/mainframe-ui": patch
"@qlan-ro/mainframe-types": patch
---

Load tool-result images when they become visible instead of embedding every image in transcript replay. Preserve gallery access to original images, cache fetched pixels, and allow failed image loads to retry. Reduce Claude session warmup allocations by skipping message payloads while scanning plan and skill metadata.

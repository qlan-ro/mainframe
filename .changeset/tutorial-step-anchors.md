---
'@qlan-ro/mainframe-ui': patch
---

Fix the first-run tour skipping from step 1 to step 4. Two of its steps were anchored to the composer, which an empty workspace never mounts, so the tour dropped them while the label still counted "of 4". Steps now carry fallback anchors on the welcome and first-run screens, and the counter is derived from the steps the tour can actually show.

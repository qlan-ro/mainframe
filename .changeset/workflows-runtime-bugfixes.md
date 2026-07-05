---
'@qlan-ro/mainframe-ui': patch
---

Fix four Workflows bugs found during e2e verification: the modal now closes on the first Escape press instead of dismissing the close button's tooltip first; a new workflow's YAML pane is now initialized from the blank draft so "Create" isn't stuck disabled until the builder is touched; the runs list now reflects a run's status the moment its detail is fetched instead of waiting for a WS event or a manual reopen; and a submitted interaction answer now stays visible on screen instead of unmounting before its confirmation renders.

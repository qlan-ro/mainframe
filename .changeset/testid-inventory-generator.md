---
'@qlan-ro/mainframe-e2e': patch
---

Add a committed testid-inventory generator (`pnpm --filter @qlan-ro/mainframe-e2e run testids`) and regenerate `UNUSED-TESTIDS.md` and `COVERAGE-GAP-REPORT.md` against the current single-tree UI, replacing the stale hand-rebuilt docs and their unreproducible `/tmp` regeneration script.

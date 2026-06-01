---
'@qlan-ro/mainframe-core': patch
---

Fix `_TaskProgress` accumulation in `groupToolCallParts`. Adapters mark the V2 task tools (`TaskCreate`/`TaskUpdate`) as both `hidden` (never a raw tool card) and `progress` (surfaced as a single `_TaskProgress` entry), but grouping checked hidden-suppression before progress-collection in the main loop and the reverse in the explore look-ahead. The result was that progress tools were dropped outright in the main loop and surfaced only when wedged between explore tools — position-dependent. Progress now takes precedence over hidden in both paths, so `_TaskProgress` is emitted consistently regardless of position. Test fixtures now mirror the real adapter categories so this can't regress.

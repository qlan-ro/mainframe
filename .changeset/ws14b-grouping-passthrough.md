---
"@qlan-ro/mainframe-core": patch
---

refactor(core): replace grouping sentinel round-trip with passthrough entry (WS14b)

`applyToolGrouping` flattened DisplayContent into a parallel PartEntry model that
only modeled text and tool-calls, smuggling every other content kind
(thinking/image/skill_loaded/…) through grouping as a magic `\0ng:N` text string
indexed into a side array, then decoding it back in two places via a regex.

Replaces that with a first-class `{ type: 'passthrough'; content }` PartEntry
variant: non-groupable content rides through grouping carrying its own data and
parentToolUseId, and decodes by returning `part.content` directly. Removes the
`nonGroupable` side array, the `\0ng:` encoding, and `NG_SENTINEL_RE`.

Pure refactor — output is byte-identical, guarded by the WS14b characterization
suite (positional interleaving, run-breaking, _TaskProgress splice, task_group
nesting, #184 agentId). Core tests 1627 pass.

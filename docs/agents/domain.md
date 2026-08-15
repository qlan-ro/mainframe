# Domain Docs

This repo has a single context: no `docs/adr/` per-subsystem split, no `CONTEXT-MAP.md`. Domain vocabulary and architectural decisions live at the repo root, built lazily by the `domain-modeling` skill (invoked via `/domain-modeling`) as terms and decisions actually come up — neither file exists until the first one is written.

## Files

- `CONTEXT.md` — the glossary. One canonical term per concept, each definition free of implementation detail. Created on the first term worth pinning down.
- `docs/adr/NNNN-title.md` — one architecture decision record per hard-to-reverse, non-obvious, genuinely-traded-off decision. Created on the first ADR.

## When a skill says "check the glossary"

Read `CONTEXT.md` if it exists. If a term you're about to use conflicts with an existing definition, treat the glossary as authoritative and resolve the conflict before proceeding.

## When a skill says "record an ADR"

Add a new `docs/adr/NNNN-title.md`, numbered sequentially. Only for decisions that are hard to reverse, would surprise a future reader without the context, and involved a real trade-off — not every choice needs one.

## When neither file exists yet

That's the expected starting state. Don't scaffold them speculatively; create `CONTEXT.md` when the first term is resolved and `docs/adr/` when the first ADR is needed, per the `domain-modeling` skill.

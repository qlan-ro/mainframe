# Validation replay (AC-3)

The scripts have unit tests; the classification step has only this. Two
historical ranges are replayed against the current `classification.md` and
checklists, without touching `state.json`. **Both must pass** — rerun after
any edit to `classification.md` or to either `CONSUMED-SURFACE.md`.

## Protocol

The classification must be produced without this file in context. Everything
below the fetch commands is grading material: target 1's pass condition names
the answer, and reading it first turns the replay into recall.

Run each target as a subagent given only the fetch command, `SKILL.md` steps
3–5, `classification.md`, and the tool's checklist. Grade its report here.

## Fetch — target 1 (Codex)

```bash
node .claude/skills/changelog-watch/scripts/fetch-delta.mjs --tool codex \
  --since rust-v0.63.0 --max 1 --out /tmp/replay-codex.md
```

Exactly one entry, `rust-v0.64.0` (2025-12-02, the oldest stable release after
the anchor — pinned by `scripts/changelog-delta.test.mjs`), `truncated: true`,
`nextAnchor: rust-v0.64.0`, body containing `#7268`. The walk is deep (~9
pages, ~40s); a transient `gh` 5xx is a retry, not a failure.

## Fetch — target 2 (Claude)

```bash
node .claude/skills/changelog-watch/scripts/fetch-delta.mjs --tool claude \
  --since 2.1.176 --max 1 --out /tmp/replay-claude.md
```

Exactly one entry, `## 2.1.178` (2.1.177 is absent from upstream's changelog),
24 bullets, `truncated: true`, `nextAnchor: 2.1.178`.

## Pass condition — target 1

The report must flag the `thread/tokenUsage/updated` v2 event (#7268) as a
**compatibility risk** that

- maps to checklist row **CODEX-EVT-04**,
- names `src/types.rs::TokenUsageUpdatedParams` as the affected consumer, and
- recommends a regression test extending `tests/event_mapper.rs`.

The mechanism, for grading only: the v2 event carries
`{"tokenUsage": {"total": {"totalTokens": …}}}` (fixture at
`src/jsonrpc.rs`), while `TokenUsageUpdatedParams` requires a top-level
snake_case `usage` object. `handle_token_usage` discards the failed parse
inside `if let Ok(p) = …`, so `state.last_usage` never updates and Codex
sessions lose their context percentage — silent, hence **high**. A complete
answer also reaches the companion gap: `src/adapter.rs::map_codex_model`
returns `context_window: None`, so the gauge has no denominator either.

## Pass condition — target 2

Deliberately unkeyed: 2.1.178's classification is written nowhere in this
repo, so this target measures the procedure rather than recall. Grade it by
running these four checks against the report — do not write down what the
right answer turned out to be.

1. **Citations resolve.** Every `file::symbol` the report cites exists: grep
   each symbol in its cited file. A risk resting on a symbol that is not
   there is a fabrication, and fails the target on its own.
2. **The code reads as claimed.** For each risk, open the cited Rust and
   confirm it consumes the surface the entry changes, in the way the report
   says. A risk that does not survive the read is a fail.
3. **Nothing relevant was missed.** After grading, walk the checklist rows
   for the tool and search the release body for each row's surface tokens.
   Every row a mechanical scan turns up must already appear in the report as
   a risk, an opportunity, or relevant-no-action. A row found only by the
   scan is a fail — a missed surface is the failure this skill exists to
   prevent.
4. **Every entry is accounted for.** The counts in the report header sum to
   24, and no entry is left unclassified.

## Records

Verdicts only. Writing a classification here would key the target for the
next run.

- **2026-07-25 — target 1: PASS.** Fetch as expected; `state.json`
  unchanged. The risk was flagged with the row, the consumer, and the
  `tests/event_mapper.rs` regression test, derived from the routing table and
  the checklist row rather than a worked example. Also produced: 2 low risks
  (additive `thread_id`/`turn_id` on CODEX-EVT-01/CODEX-ITEM-01, tolerated by
  lenient deserialization), 5 adoption opportunities, 68 dropped.
- **Target 2: not yet run** — added after the first live replay, to gate the
  classification step on a range no file in this repo answers.

## Maintenance

- Never add a target's entries to `classification.md`'s worked examples, and
  never restate a target's answer in a checklist row. Either turns the gate
  into recall; the CODEX-EVT-04 row carried exactly that leak until it was
  moved into the target 1 pass condition above.
- If upstream drops a replayed release, pick a new range that touches a
  consumed surface, reset that target's record, and keep target 2 unkeyed.

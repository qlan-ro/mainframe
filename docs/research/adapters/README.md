# Adapter consumed-surface checklists

A consumed-surface checklist inventories the upstream CLI behaviours Mainframe's
Rust daemon depends on — spawn flags, stream/event shapes, control-protocol
messages, on-disk session formats, prose-sensitive parsers — each row anchored
to the code that depends on it. `.claude/skills/changelog-watch/SKILL.md`
classifies upstream changelog entries against these rows (risk / adoption
opportunity / noise); `.claude/skills/{claude,codex}-protocol-debugger/`
verify a suspected live change against the running CLI.

One file per tool: `docs/research/adapters/claude/CONSUMED-SURFACE.md`,
`docs/research/adapters/codex/CONSUMED-SURFACE.md`.

## Row schema

```
ID | Surface | Upstream artifact | Mainframe consumer (file::symbol) | Coverage | Verified | Breakage symptom
```

- **ID** — `<TOOL>-<CAT>-<NN>`, `TOOL ∈ {CLAUDE, CODEX}`,
  `CAT ∈ {FLAG, EVT, CTRL, RPC, ITEM, FILE, PROBE, IO, ENV}` (`IO` = stdio
  transport and log-line conventions, `ENV` = environment variables the child
  process is spawned with), `NN` zero-padded. IDs are permanent —
  never renumbered. A surface Mainframe stops consuming is marked `retired`
  in place, so IDs cited by old reports and todos stay resolvable.
- **Mainframe consumer** cites `path::symbol`, never line numbers — line
  numbers rot within weeks and the validator
  (`.claude/skills/changelog-watch/scripts/check-surface.mjs`, run in CI)
  greps for the symbol. Two citation forms only, because the validator
  resolves exactly these: bare
  `src/…` or `tests/…` for files in the crate the checklist documents
  (`mainframe-adapter-claude` or `mainframe-adapter-codex`), and a **full**
  worktree-relative `packages/…` path for anything else — another crate, the
  types crate, a UI mirror. Never a shorthand like
  `mainframe-background-tasks/src/encoding.rs`; it resolves against neither
  root and slips through unchecked.
- **Coverage** names the existing test that would fail, or `none`. Only Rust
  unit and integration tests count — the e2e recordings in
  `packages/e2e/fixtures/recordings/` replay Mainframe's *adapter API*
  (`onInit`, `onMessage`, `onCompact`), not raw CLI wire shapes, so they keep
  passing after an upstream protocol break. Never cite them as coverage.
- **Verified** is the CLI version a row was last confirmed against, where the
  code records one. Write `—` when nothing records one; do not invent a
  version.
- **Breakage symptom** is the user-visible failure, in one clause.

Each tool file ends with a **"Not consumed — adoption candidates"** section
listing upstream capabilities Mainframe deliberately does not use. Without it
the skill has nothing to map an adoption opportunity onto.

## Update protocol

Changing what Mainframe consumes from a CLI updates the row in the same PR.
Renaming or moving a cited symbol breaks CI, which runs

```bash
node .claude/skills/changelog-watch/scripts/check-surface.mjs
```

over both files: every row must cite a consumer, and every cited file and
symbol must exist. `::{a, b}` checks each name. Fix the row, never the
validator — a row whose citation no longer resolves is a row nothing
consumes.

## Budget

≤300 lines and ≤30 rows per tool file. Collapse variant families (the Codex
`ThreadItem` union, the Claude JSONL field set) into one row pointing at the
enum or parser; do not enumerate every variant.

## Not the daemon's own wire contract

`docs/rust-port/CONTRACT/*.json` is Mainframe's *own* daemon↔client wire
contract. It is not an upstream CLI surface and never belongs in these
checklists.

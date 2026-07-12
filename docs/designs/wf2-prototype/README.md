# Automations v2 — prototype snapshot

Verbatim snapshot of the claude.ai/design prototype for Automations (Workflows v2).
These are REFERENCE copies — the visual/interaction spec for the `packages/ui` port,
not app code. The product spec is `docs/designs/2026-07-11-automations-v2-spec.md`.

## Provenance

- **Design project:** claude.ai/design, id `63fecfba-4e43-416e-8ef7-e753512d2a25`
- **Fetched:** 2026-07-12 (via DesignSync `get_file`)
- **Cache token:** `ts153` — every wf2 script src in the review HTML carries `?v=ts153`.
  Supersedes the 2026-07-12 `ts152` snapshot, which predated the requested fix pass.
- The HTML also loads `mainframe/01-base.jsx` (shared prototype base kit: `T`, `FS`,
  `RADIUS`, `Icon`, fonts — intentionally not snapshotted, not wf2-specific) and
  `design-canvas.jsx` (harness, no cache token).

## Inventory

| File | Lines | Role |
|---|---|---|
| `wf2-base.jsx` | 270 | Token model (`tk`), verbs/blocks/events/schedules, action catalog data, `wf2StepProduces` scope rules |
| `wf2-fields.jsx` | 160 | `WfChipField` (chip-part editor), `WfTokenPicker`, `WfChipText`, `WfSchedulePicker`, `WfMiniSelect` |
| `wf2-editor.jsx` | 420 | `WfEditor` shell, `wf2Validate`, `WfRecipe`/`WfStepCard`, If/Repeat bodies, condition rows, add menu, When card |
| `wf2-stepconfig.jsx` | 312 | Per-verb config panels, auto-generated action forms, action catalog UI, credential Connect, failure toggle, attachments |
| `wf2-runtime.jsx` | 276 | Library, blank state, Describe-it flow, run view (timeline / paused form / failed / fan-out), notifications |
| `wf2-seeds.jsx` | 153 | Demo data: the six spec-§12 reference automations, run/notification seeds, mock credentials (supplementary fetch) |
| `Automations v2 Review.html` | 218 | Review artboard page wiring the modules together |

## Status of previously flagged issues (checked 2026-07-12 against `ts153`)

All five issues from the earlier review pass are **fixed** in this revision:

1. **If-branch token scope — FIXED.** `wf2StepProduces` recurses into `then`/`else`
   children (`wf2-base.jsx:185-193`), and `WfRecipe` accumulates each prior sibling's
   produces into the running scope (`wf2-editor.jsx:66-68`), so steps after an If see
   branch outputs. Repeat is deliberately excluded — `⟨Current item⟩` never escapes.
2. **`tk()` carries options — FIXED.** `options: opts.options || null` on the token
   (`wf2-base.jsx:29`); the askme producer forwards `f.options` (`wf2-base.jsx:183`);
   choice-token conditions render an options dropdown (`wf2-editor.jsx:201-203`).
3. **Validation pinned to the offending step — FIXED.** Every issue carries `stepId`
   (`wf2-editor.jsx:45-47`); `WfStepCard` filters `issues` by `step.id` and renders a
   red strip on the card itself (`wf2-editor.jsx:89-95`), on both leaf and block cards.
   The footer summary remains as a secondary surface.
4. **Per-step "keep going if this fails" — PRESENT.** `WfFailureToggle` stores
   `step.continueOnError` (`wf2-stepconfig.jsx:36-40`), wired into the More-options
   area of all four verbs; the run view shows a "Kept going" badge
   (`wf2-runtime.jsx:207`).
5. **Ask-agent attachments — PRESENT.** `WfAttachments` in Ask-agent More options
   (`wf2-stepconfig.jsx:45-63`, wired at `185-187`).

Nothing remains unfixed, so the UI port follows the prototype behavior directly. Had
any item still been open, the port would implement the spec-correct behavior regardless —
the spec (`2026-07-11-automations-v2-spec.md`) stays authoritative over the prototype
wherever the two ever disagree.

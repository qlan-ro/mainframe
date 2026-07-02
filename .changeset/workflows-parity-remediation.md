---
"@qlan-ro/mainframe-ui": patch
"@qlan-ro/mainframe-core": patch
"@qlan-ro/mainframe-types": patch
---

Second Workflows-UI design-parity pass, closing the remaining drift-audit findings.

Serializer/grammar: the editor now emits canonical workflow YAML — a `version: 1`
header, an `id` on every step (including composites), inputs as a map, a structured
question `timeout: { afterMinutes, onTimeout }`, and a conditional `triggers:` block
that no longer serializes UI-only manual triggers. Fixed the step-library kind
mapping so branch/loop/subflow cards show their own icon and label instead of
falling back to Service.

Run detail: the daemon now emits leaf `duration`/`sub`/`waitFor` and composite
`summary` on `RunTreeNode`, plus a status-tinted `banner`/`bannerCta` on
`WorkflowRunSummary`, and the UI renders them; the run-detail back icon, parent-run
link, loop-iteration status color, fill glyphs, and hairline borders were brought to
parity. Library rows show the real project name; the shell gained a title count chip,
a header close button, Escape-to-back-out of a run, and a larger editor modal.
Rounded out with a compressed-spacing sweep across the builder, warning-token fixes,
and shared Hint tooltips on icon-only controls.

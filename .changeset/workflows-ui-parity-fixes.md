---
"@qlan-ro/mainframe-ui": patch
"@qlan-ro/mainframe-types": patch
---

Workflows UI design-parity pass + step-picker fix. Rebuilt the run-detail rail
tree (spine, on-spine status pips, composite headers, waiting ping halo, hollow
running spinner, restored ambiguous error text); fixed pervasive compressed
spacing across every surface; restored the interaction prompt line and
future-tense expiry copy; corrected the run trigger-kind display to the engine's
real `manual|cron|event|call` and widened the definition trigger enum to
`manual|schedule|event|webhook`; and fixed the step-type picker that rendered as
an empty panel (it now opens as a bounded centered modal). Adds an optional
`prompt` to `WorkflowInteractionSummary`.

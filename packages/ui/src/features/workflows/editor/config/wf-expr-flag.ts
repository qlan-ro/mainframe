/**
 * WF_EXPR_ENABLED — feature flag gating `expr`-marked fields to `WfExprInput`
 * (Task 17) instead of a plain `Input`/`Textarea`. Its own module so both
 * `WfFieldControl.tsx` and `WfKvEditor.tsx` can read it without a circular
 * import between the two.
 */
export const WF_EXPR_ENABLED = true;

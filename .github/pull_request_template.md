<!-- Write for a reviewer who has not seen the agent conversation. Aim for 150–300 words for an ordinary PR; use less for small changes and more only when risk needs it. Use this same template for manual and automated PRs. Preserve its headings, order, and checklist; remove guidance and only optional/inapplicable sections. Put additional pipeline context in comments, not custom description sections. Summarize the final change, not the sequence of agent work. -->

## Summary

<!-- Explain the problem and resulting behavior. Include a concrete before/after example when useful. -->

## Related work

<!-- Link the GitHub issue, todo, and relevant design. Write "None" if there is no related work item. -->

## Changes

<!-- Optional: 2–4 changes or tradeoffs needed for review. Omit when Summary already covers them. Put useful extended rationale in one collapsible Implementation notes comment and link it here; update it on reruns. Do not paste stage decisions, reviewer transcripts, local paths, or staging/retry history. -->

## Validation

<!-- State the commands or scenarios actually run and their results. Include relevant regression checks. If checks were not run, explain why and what remains unverified. -->

## Risks and rollout

<!-- Optional: material compatibility, deployment/rollback concerns, and unresolved review or testing gaps. Summarize and deduplicate findings; keep full agent logs outside the PR body. -->

## Visual evidence

<!-- For visible changes: embed 2–3 screenshots or link a short video from live QA, with captions and the tested commit. Include relevant light/dark themes or viewports. Local paths are not uploaded evidence. For nonvisual changes, state why evidence is not needed. If capture/upload is blocked, state the gap. -->

## Review checklist

- [ ] I reviewed the diff and kept unrelated changes out.
- [ ] Validation above accurately records completed checks and remaining gaps.
- [ ] Applicable documentation, API consumers, migrations, and a changeset are addressed.
- [ ] Visual evidence is attached for visible changes, or the reason it is not needed is stated.

# File explorer path tooltip delay

Approved todo #370, size S, no-spec route. Implement 500ms pointer hover for file and folder paths, with every row visit receiving the delay. Keep folder toggles, file opening, nearby rows, context menus, keyboard navigation and full-path access usable. Other tooltips retain their defaults.

## Established facts

- `packages/ui/src/features/files/FileTreeNode.tsx`, `FileTreeNode`, renders both path hints through `TruncatedWithTooltip`. Row buttons own navigation and toggling; `FileTreeRowMenu` owns Copy Path and other context actions.
- `packages/ui/src/components/ui/truncated-with-tooltip.tsx`, `TruncatedWithTooltip`, permits custom path text even without clipping. Its outer provider is shadowed by the provider inside `Tooltip` in `packages/ui/src/components/ui/tooltip.tsx`. Both currently default to zero delay.
- The installed `radix-ui` import resolves to `@radix-ui/react-tooltip@1.2.16`, `dist/index.js`. `Tooltip` gives its own `delayDuration` precedence, but `onTriggerEnter` consults provider skip-delay state. Each wrapper has its own provider; returning to a recently opened row can bypass its delay. `TooltipProvider` with `skipDelayDuration=0` keeps opening delayed.
- Radix `TooltipContentHoverable` tracks pointer travel between trigger and content. `disableHoverableContent` closes on trigger leave; it does not make content transparent to pointer hit testing. `TooltipContentImpl` leaves outside pointer events enabled. Our portaled content has no pointer-events override. This explains immediate timing and possible overlap, not the historical failed click. The parent owns a bounded unchanged-source browser attempt and records whether it reproduces.

## Task group 1: UI behavior and regression coverage

One UI owner implements and tests the change together. Dependencies are the approved brief, prepared UI dependencies/shared types, and the parent's baseline attempt or explicit limitation before source edits. The parent owns independent plan review and live QA.

Owned production files are `packages/ui/src/components/ui/tooltip.tsx`, `packages/ui/src/components/ui/truncated-with-tooltip.tsx`, and `packages/ui/src/features/files/FileTreeNode.tsx`.

1. Add narrow optional timing and hover configuration to `TruncatedWithTooltip`. Forward the opening delay to the actual Radix root and skip-delay control through `Tooltip` to its inner provider. Preserve current defaults and truncation eligibility for existing callers. Remove the now-redundant outer provider and revise the wrapper's stale zero-delay comment if needed. Do not add a separate timer state machine or general tooltip configuration framework.
2. Configure both file and directory hints with a 500ms delay and zero skip delay. Make only these path hints non-hoverable and their content pointer-transparent using the existing content class hook. Keep full path text, row handlers, focus behavior and Radix tooltip semantics. Do not add a focus stop to the inner label. Keep existing keyboard-accessible Copy Path behavior.
3. Extend `packages/ui/src/components/ui/__tests__/truncated-with-tooltip.test.tsx` and add `packages/ui/src/features/files/__tests__/FileTree.tooltip.test.tsx`. Use real tooltip components and controlled time. Assert no path hint at 499ms, full path at 500ms, cancellation on early leave, and fresh delay across rows including A→B→A after A opened. Cover both file and directory wiring. Retain immediate default behavior and clipping coverage for other callers. Assert first-click folder toggle/file intent before and after opening, dismissal, focus semantics and full-path content. Keep each file below 300 lines; do not enlarge the existing large FileTree suite.
4. Add `.changeset/file-explorer-path-tooltip-delay.md` with a patch entry for `@qlan-ro/mainframe-ui` describing the delayed, unobstructive path hints.

## Verification and exit criteria

Run the affected tooltip suites separately, existing `FileTree.test.tsx` and `FileTree.reveal.test.tsx`, UI typecheck, and scoped ESLint/Prettier checks. All must pass before the implementation commit. Record actual commands and results in the external lane checkpoint, scan staged content for secrets, and use normal commit hooks.

Browser QA must exercise dense nested folders and long paths, fast row traversal and returns, first-click expansion/collapse, file opening, and clicks on nearby rows while a hint is visible. Check actual rendered hit targets and computed pointer behavior; jsdom event dispatch does not prove unobstructed hit testing. Verify row Tab navigation, Enter/Space activation, Escape dismissal, context menus and Copy Path, plus full-path tooltip semantics. Report pre-fix reproduction separately from post-fix results. If the historical obstruction cannot be reproduced, record that limit and still verify the acceptance scenarios. Exit requires passing checks, passing browser scenarios or an explicit unresolved QA blocker, a UI changeset, and parent review clearance before delivery.

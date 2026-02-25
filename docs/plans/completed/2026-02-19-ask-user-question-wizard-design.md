# Ask User Question Wizard Design

## Context
`AskUserQuestionCard` currently renders all questions at once and uses inline option chips where option descriptions are hidden behind `title` tooltips.

## User-Driven Requirements
- Render questions one-by-one as a wizard flow.
- Present options as a vertical list instead of inline chips.
- Show option descriptions directly next to labels (always visible).
- Do not block on follow-up questions; proceed with sensible defaults.

## Decision
Implement a single-step question view with step navigation (`Back` / `Next` / `Submit`) and keep answer persistence across steps by reusing existing per-question selection state maps.

## UX Behavior
- Header shows the first question header and progress (`Question N of M`).
- Only the active question is rendered.
- `Next` is enabled only when the current question has a selection.
- `Submit` appears only on the last step and is enabled only when that step has a selection.
- `Skip` remains available and denies the permission request.

## Data / Submission
- Keep output shape unchanged: `answers` keyed by original `question` text.
- Preserve `multiSelect` behavior and `Other` text support.

## Testing Strategy
- Add component-level tests for: sequential rendering, next/back navigation, visible descriptions, and final submit payload.

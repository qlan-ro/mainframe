# Onboarding Tutorial Design

**Date:** 2026-02-20
**Status:** Approved

## Overview

A 3-step first-run tutorial using a spotlight cutout overlay. Shows once on first launch, auto-dismissed once the user completes all steps or explicitly skips.

## Trigger & Persistence

- Detected via `mf:tutorial:completed` in localStorage, managed by a new `useTutorialStore` Zustand store with the `persist` middleware (consistent with `useUIStore` and `useThemeStore`).
- Shows automatically when `completed === false` on app launch.
- Never shows again after completion or skip.

## Overlay Mechanics

- A full-screen `fixed` div (highest z-index) with `rgba(0,0,0,0.65)` background.
- Target element's position read via `getBoundingClientRect()` on each step.
- Spotlight "hole" cut using `box-shadow: 0 0 0 9999px rgba(0,0,0,0.65)` on a positioned highlight div, with a glow `outline` ring around it.
- The target element stays fully interactive — clicking it advances the tutorial.
- Highlight div transitions position with `transition: all 0.3s ease` between steps.

## Steps

| Step | Target element | `data-tutorial` | Title | Description |
|------|---------------|-----------------|-------|-------------|
| 1 | ProjectRail `+` button | `step-1` | Add a project | Point Mainframe to a codebase by adding your first project |
| 2 | ChatsPanel New Session button | `step-2` | Start a session | Open a new conversation with your AI agent |
| 3 | Composer input textarea | `step-3` | Send a message | Type a task and press Enter to begin |

## Annotations & Arrows

- Each step renders a label card (title + description) positioned relative to the spotlight hole, auto-adjusted to stay on-screen.
- A hand-drawn-style SVG curved arrow in orange/amber connects the label card to the highlighted element.
- A "Skip tutorial" text link appears in the bottom-right corner of the overlay on every step.
- A "Next →" button on the label card lets users advance manually without completing the action.

## Architecture

### `useTutorialStore` (`store/tutorial.ts`)
```ts
interface TutorialState {
  completed: boolean;
  step: number; // 1-indexed, 1–3
  nextStep: () => void;
  complete: () => void;
  skip: () => void;
}
```
Persisted via Zustand `persist` middleware under key `mf:tutorial`.

### `TutorialOverlay.tsx` (`components/TutorialOverlay.tsx`)
- Rendered in `App.tsx` unconditionally; returns `null` when `completed === true`.
- Reads store state. Measures target via `document.querySelector('[data-tutorial="step-N"]')`.
- Renders: overlay div, spotlight hole div, SVG arrow, label card.

### Target Attributes
- `data-tutorial="step-1"` added to ProjectRail `+` button.
- `data-tutorial="step-2"` added to ChatsPanel New Session button.
- `data-tutorial="step-3"` added to ComposerCard textarea.

### Advancement Logic
- Step 1 → 2: triggered when `projects` array in store goes from empty to non-empty (watch via `useProjectsStore`).
- Step 2 → 3: triggered when a new chat is created for the active project (watch `chats` array).
- Step 3 → complete: triggered when the first message is sent (watch `messages` for active chat).
- Fallback: "Next →" button on label card advances without requiring the action.

## Files Touched

| File | Change |
|------|--------|
| `store/tutorial.ts` | New file — `useTutorialStore` |
| `components/TutorialOverlay.tsx` | New file — overlay component |
| `App.tsx` | Render `<TutorialOverlay />` |
| `components/ProjectRail.tsx` | Add `data-tutorial="step-1"` |
| `panels/ChatsPanel.tsx` | Add `data-tutorial="step-2"` |
| `chat/assistant-ui/composer/ComposerCard.tsx` | Add `data-tutorial="step-3"` |

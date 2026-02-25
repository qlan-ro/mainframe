# Ask User Question Wizard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert `AskUserQuestionCard` into a step-by-step wizard and show option descriptions inline in a list layout.

**Architecture:** Keep the existing state maps for selections and `Other` text, add a `currentQuestionIndex` pointer, and render only the active question. Navigation controls gate progression using active-question selection state while preserving existing submit payload shape.

**Tech Stack:** TypeScript, React 19, Vitest (jsdom), existing desktop UI primitives.

---

### Task 1: Add failing wizard tests

**Files:**
- Create: `packages/desktop/src/renderer/components/chat/AskUserQuestionCard.test.ts`
- Test: `packages/desktop/src/renderer/components/chat/AskUserQuestionCard.test.ts`

1. Write failing tests for one-question-at-a-time rendering.
2. Write failing tests for `Next`/`Back` flow.
3. Write failing tests that option descriptions are visible text.
4. Write failing test that final `Submit` sends all answers.

### Task 2: Implement wizard rendering + navigation

**Files:**
- Modify: `packages/desktop/src/renderer/components/chat/AskUserQuestionCard.tsx`

1. Add active question index state.
2. Render only active question.
3. Add progress text and step controls.
4. Keep `Skip` behavior unchanged.
5. Show descriptions directly in option rows.

### Task 3: Verify

**Files:**
- Test: `packages/desktop/src/renderer/components/chat/AskUserQuestionCard.test.ts`
- Verify: `packages/desktop/src/renderer/components/chat/AskUserQuestionCard.tsx`

1. Run: `pnpm --filter @mainframe/desktop test -- src/renderer/components/chat/AskUserQuestionCard.test.ts`
2. Run: `pnpm --filter @mainframe/desktop exec tsc --noEmit`
3. Confirm tests and typecheck pass.

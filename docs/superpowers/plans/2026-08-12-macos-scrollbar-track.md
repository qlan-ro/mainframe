# macOS Scrollbar Track Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep scrollbar tracks transparent when macOS WKWebView expands its native scrollbar.

**Architecture:** Select one scrollbar styling API per engine capability. WebKit/Blink engines receive pseudo-element rules that directly paint the track; other engines retain the standard CSS Scrollbars rules.

**Tech Stack:** CSS, Tailwind CSS v4 layers, Vitest, Tauri 2/WKWebView

## Global Constraints

- Keep the rules in `@layer base` so scrollbar utility classes retain precedence.
- Never combine non-default standard scrollbar properties with WebKit pseudo-element styling in the same capability branch.
- Preserve the transparent-at-rest and hover-revealed-thumb interaction.
- Do not change theme tokens, components, or application behavior outside scrollbar painting.

---

### Task 1: Split scrollbar styling by engine capability

**Files:**
- Create: `packages/ui/src/styles/__tests__/scrollbar-styles.test.ts`
- Modify: `packages/ui/src/styles/app.css:59-73`

**Interfaces:**
- Consumes: `--border`, Tailwind's `base` and `utilities` layer ordering, and `selector()` support queries.
- Produces: mutually exclusive WebKit pseudo-element and standards-based scrollbar rules.

- [ ] **Step 1: Write the failing stylesheet contract test**

Create a node-environment Vitest test that reads `app.css`, extracts balanced `@supports` blocks, and asserts:

```ts
expect(webkit).toContain('*::-webkit-scrollbar-track');
expect(webkit).toMatch(/background:\s*transparent/);
expect(webkit).toContain('*:hover::-webkit-scrollbar-thumb');
expect(webkit).not.toMatch(/scrollbar-(?:color|width)\s*:/);
expect(standards).toContain('scrollbar-width: thin');
expect(standards).toContain('scrollbar-color: transparent transparent');
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/styles/__tests__/scrollbar-styles.test.ts`

Expected: FAIL because `app.css` has no WebKit capability branch.

- [ ] **Step 3: Add mutually exclusive scrollbar branches**

Inside the existing `@layer base`, add:

```css
@supports selector(*::-webkit-scrollbar) {
  *::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  *::-webkit-scrollbar-track,
  *::-webkit-scrollbar-corner {
    background: transparent;
  }
  *::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
  }
  *:hover::-webkit-scrollbar-thumb {
    background: var(--border);
  }
}
```

Move the current standard declarations under `@supports not selector(*::-webkit-scrollbar)`.

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/styles/__tests__/scrollbar-styles.test.ts`

Expected: PASS.

- [ ] **Step 5: Run static verification**

Run:

```bash
pnpm --filter @qlan-ro/mainframe-ui typecheck
pnpm --filter @qlan-ro/mainframe-ui build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 6: Verify the packaged macOS app**

Build a release-profile QA app, load a long dark-mode chat, capture the native window with `screencapture`, and inspect the right edge. The track must match the chat background both at rest and while the thumb is visible.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/styles/app.css packages/ui/src/styles/__tests__/scrollbar-styles.test.ts docs/superpowers/plans/2026-08-12-macos-scrollbar-track.md
git commit -m "fix(ui): keep macOS scrollbar tracks transparent"
```

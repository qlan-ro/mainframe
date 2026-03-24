# Branch Management — E2E Test Gap

No E2E tests exist for the branch management feature (popover, checkout, merge, rebase, etc.).

## Why

Git operations require a real repository with specific state (branches, remotes, conflicts), making E2E tests unreliable without significant fixture setup. The daemon would need to operate on a disposable test repo rather than the actual project.

## Coverage

Unit and integration tests exist in:
- `packages/core/src/__tests__/git/git-service.test.ts` — GitService with mocked simple-git
- `packages/core/src/__tests__/routes/git-write.test.ts` — REST endpoint integration tests
- `packages/desktop/src/__tests__/components/git/BranchPopover.test.tsx` — UI component tests
- `packages/desktop/src/__tests__/components/Toaster.test.tsx` — Toast system tests

## Future work

To add E2E coverage:
1. Create a fixture that initializes a temporary git repo with branches and remotes
2. Point the daemon at this fixture repo
3. Test: open popover, checkout a branch, verify status bar updates
4. Test: create branch, verify it appears in the list
5. Test: merge with conflicts, verify conflict view appears

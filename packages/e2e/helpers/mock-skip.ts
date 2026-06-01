import { test } from '@playwright/test';

/**
 * Skips the current test when running under `E2E_MODE=mock`.
 *
 * Use in `test.beforeEach` for AI-coupled specs that have no mock fixture — either because they
 * assert real tool side-effects (file/git changes) that mock-cli does not reproduce, or because
 * their flow is nondeterministic/complex to record. This lets a full `E2E_MODE=mock` run complete
 * green (these specs skip with a reason) instead of failing. See plugins/mock-cli/RECORDING-STATUS.md.
 */
export function skipUnrecordedInMock(): void {
  test.skip(
    process.env['E2E_MODE'] === 'mock',
    'No mock fixture — runs against the real CLI only (see plugins/mock-cli/RECORDING-STATUS.md)',
  );
}

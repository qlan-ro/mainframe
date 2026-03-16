import { describe, it, expect } from 'vitest';
import { useLaunchConfig } from '../../renderer/hooks/useLaunchConfig.js';

/**
 * renderHook-based tests are blocked by a pre-existing React 19 + @testing-library/react
 * compatibility issue (React.act is not a function). This affects ALL hook/component tests
 * in the desktop package (useProject.test.ts, ConnectionOverlay.test.tsx, etc.).
 *
 * For now, verify the hook exports correctly and the module loads without errors.
 * Full behavioral tests (context.updated refresh, window focus refresh, chatId scoping)
 * should be added once the testing-library version is updated.
 */
describe('useLaunchConfig', () => {
  it('exports a function', () => {
    expect(typeof useLaunchConfig).toBe('function');
  });
});

import { expect, it } from 'vitest';
import { projectToolLifecycle } from '../tool-call-lifecycle';

it.each(['pending', 'in_progress', 'completed', 'failed', 'cancelled'] as const)(
  'projects only the supplied %s lifecycle',
  (status) => {
    expect(projectToolLifecycle(status)).toEqual({ acpStatus: status });
  },
);

it('leaves missing lifecycle unavailable', () => {
  expect(projectToolLifecycle(undefined)).toBeUndefined();
});

/**
 * mfToast.permission unit test.
 *
 * Asserts the permission helper fires a `type: 'permission'` toast with
 * `duration: Infinity` (persistent — no auto-dismiss), mirroring the error
 * helper's persistence but for the actionable trust-workspace flow.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toast } from 'sonner';
import { mfToast } from '../toast';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { custom: vi.fn(), dismiss: vi.fn() }) }));

describe('mfToast.permission', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a persistent (Infinity) permission toast', () => {
    mfToast.permission('Workspace not trusted', { description: 'why' });
    const opts = (toast.custom as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(opts.duration).toBe(Infinity);
  });
});

/**
 * mfToast unit tests — the native-sonner reimplementation.
 *
 * Pins the type→policy table (errors/permission persist with a close button,
 * the rest auto-dismiss), the chatId→Open-session CTA, and the details
 * affordance (a Details cancel-slot button that parks the payload for
 * ToastDetailsHost).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toast } from 'sonner';
import { mfToast } from '../toast';
import { useToastDetails } from '@/store/toast-details';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock('@/lib/session-nav', () => ({ openSessionById: vi.fn() }));

type MockedToast = Record<'success' | 'error' | 'warning' | 'info', ReturnType<typeof vi.fn>>;
const mocked = toast as unknown as MockedToast;

function lastCall(method: keyof MockedToast) {
  const calls = mocked[method].mock.calls;
  return { title: calls[calls.length - 1]![0], opts: calls[calls.length - 1]![1] };
}

beforeEach(() => {
  vi.clearAllMocks();
  useToastDetails.setState({ payload: null });
});

describe('mfToast — type policy', () => {
  it('errors persist: Infinity duration with a close button', () => {
    mfToast.error('Push failed', { description: 'why' });
    const { title, opts } = lastCall('error');
    expect(title).toBe('Push failed');
    expect(opts.duration).toBe(Infinity);
    expect(opts.closeButton).toBe(true);
  });

  it('permission renders as a persistent warning toast', () => {
    mfToast.permission('Workspace not trusted', { description: 'why' });
    const { opts } = lastCall('warning');
    expect(opts.duration).toBe(Infinity);
    expect(opts.closeButton).toBe(true);
  });

  it('success auto-dismisses without a close button', () => {
    mfToast.success('Branch pushed');
    const { opts } = lastCall('success');
    expect(opts.duration).not.toBe(Infinity);
    expect(opts.closeButton).toBe(false);
  });
});

describe('mfToast — actions', () => {
  it('chatId produces an Open session action', () => {
    mfToast.info('Turn finished', { chatId: 'chat-1' });
    const { opts } = lastCall('info');
    expect(opts.action.label).toBe('Open session');
  });

  it('an explicit action takes precedence over the chatId CTA', () => {
    const onClick = vi.fn();
    mfToast.info('Turn finished', { chatId: 'chat-1', action: { label: 'Retry', onClick } });
    const { opts } = lastCall('info');
    expect(opts.action.label).toBe('Retry');
  });
});

describe('mfToast — details affordance', () => {
  it('details adds a Details button that parks the payload for the host dialog', () => {
    mfToast.error('Agent Error', { description: 'exit 1', details: 'stack trace here' });
    const { opts } = lastCall('error');
    expect(opts.cancel.label).toBe('Details');

    opts.cancel.onClick();
    expect(useToastDetails.getState().payload).toEqual({
      title: 'Agent Error',
      description: 'exit 1',
      details: 'stack trace here',
    });
  });

  it('no details → no Details button', () => {
    mfToast.error('Agent Error');
    const { opts } = lastCall('error');
    expect(opts.cancel).toBeUndefined();
  });
});

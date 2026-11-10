// @vitest-environment jsdom
/**
 * mfToast unit tests — the native-sonner reimplementation.
 *
 * Slots are React elements (footer + in-card close), so tests render them.
 * Pins the type→policy table (errors/permission persist with a close button,
 * the rest auto-dismiss), the chatId→Open-session CTA, and the details
 * affordance (a Details cancel-slot button that parks the payload for
 * ToastDetailsHost).
 */
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';
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

function renderSlot(el: unknown) {
  return render(React.createElement(React.Fragment, null, el as React.ReactNode));
}

describe('mfToast — type policy', () => {
  it('errors persist: Infinity duration, generated id, in-card close (sonner closeButton off)', () => {
    mfToast.error('Push failed', { description: 'why' });
    const { title, opts } = lastCall('error');
    expect(title).toBe('Push failed');
    expect(opts.duration).toBe(Infinity);
    expect(opts.closeButton).toBe(false);
    expect(typeof opts.id).toBe('string');
    renderSlot(opts.action);
    fireEvent.click(screen.getByTestId('toast-close'));
    expect(toast.dismiss).toHaveBeenCalledWith(opts.id);
  });

  it('permission renders as a persistent warning toast with a close', () => {
    mfToast.permission('Workspace not trusted', { description: 'why' });
    const { opts } = lastCall('warning');
    expect(opts.duration).toBe(Infinity);
    renderSlot(opts.action);
    expect(screen.getByTestId('toast-close')).toBeTruthy();
  });

  it('success auto-dismisses with no slots', () => {
    mfToast.success('Branch pushed');
    const { opts } = lastCall('success');
    expect(opts.duration).not.toBe(Infinity);
    expect(opts.closeButton).toBe(false);
    expect(opts.action).toBeUndefined();
  });

  it('each raise gets its own id', () => {
    mfToast.info('a');
    const a = lastCall('info').opts.id;
    mfToast.info('b');
    expect(lastCall('info').opts.id).not.toBe(a);
  });
});

describe('mfToast — actions', () => {
  it('chatId produces an Open session button that runs then dismisses', async () => {
    const { openSessionById } = await import('@/lib/session-nav');
    mfToast.info('Turn finished', { chatId: 'chat-1' });
    const { opts } = lastCall('info');
    renderSlot(opts.action);
    fireEvent.click(screen.getByTestId('toast-action'));
    expect(openSessionById).toHaveBeenCalledWith('chat-1');
    expect(toast.dismiss).toHaveBeenCalledWith(opts.id);
  });

  it('an explicit action takes precedence over the chatId CTA', () => {
    const onClick = vi.fn();
    mfToast.info('Turn finished', { chatId: 'chat-1', action: { label: 'Retry', onClick } });
    renderSlot(lastCall('info').opts.action);
    expect(screen.getByTestId('toast-action').textContent).toBe('Retry');
    fireEvent.click(screen.getByTestId('toast-action'));
    expect(onClick).toHaveBeenCalled();
  });
});

describe('mfToast — details affordance', () => {
  it('details adds a Details button that parks the payload for the host dialog', () => {
    mfToast.error('Agent Error', { description: 'exit 1', details: 'stack trace here' });
    const { opts } = lastCall('error');
    renderSlot(opts.action);
    fireEvent.click(screen.getByTestId('toast-details'));
    expect(useToastDetails.getState().payload).toEqual({
      title: 'Agent Error',
      description: 'exit 1',
      details: 'stack trace here',
    });
  });

  it('no details and no description → no Details button', () => {
    mfToast.error('Agent Error');
    renderSlot(lastCall('error').opts.action);
    expect(screen.queryByTestId('toast-details')).toBeNull();
  });
});

describe('mfToast — clamped description', () => {
  function mockOverflow(overflowing: boolean) {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(overflowing ? 100 : 20);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(40);
  }

  it('overflow re-issues once by id with the full text as details', () => {
    mockOverflow(true);
    mfToast.error('Agent Error', { description: 'long text' });
    const first = lastCall('error').opts;
    renderSlot(first.description);
    expect(mocked.error).toHaveBeenCalledTimes(2);
    const second = lastCall('error').opts;
    expect(second.id).toBe(first.id);
    renderSlot(second.action);
    fireEvent.click(screen.getByTestId('toast-details'));
    expect(useToastDetails.getState().payload?.details).toBe('long text');
  });

  it('short text triggers no re-issue', () => {
    mockOverflow(false);
    mfToast.error('Agent Error', { description: 'short' });
    renderSlot(lastCall('error').opts.description);
    expect(mocked.error).toHaveBeenCalledTimes(1);
  });

  it('a caller-supplied details is never replaced', () => {
    mockOverflow(true);
    mfToast.error('Agent Error', { description: 'long text', details: 'mine' });
    renderSlot(lastCall('error').opts.description);
    expect(mocked.error).toHaveBeenCalledTimes(1);
  });
});

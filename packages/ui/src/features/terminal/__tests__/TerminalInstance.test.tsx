import { render, screen, cleanup } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';

interface MockEntry {
  wrapper: HTMLDivElement;
  term: { focus: ReturnType<typeof vi.fn> };
  fitAddon: { fit: ReturnType<typeof vi.fn> };
  disposers: never[];
}

// A per-id entry factory so focus tests can assert on the RIGHT terminal's
// term.focus without cross-talk between ids.
const entries = new Map<string, MockEntry>();
function makeEntry(): MockEntry {
  return {
    wrapper: document.createElement('div'),
    term: { focus: vi.fn() },
    fitAddon: { fit: vi.fn() },
    disposers: [],
  };
}
const getOrCreateSpy = vi.fn((id: string) => entries.get(id) ?? entries.set(id, makeEntry()).get(id)!);
const getCachedTerminalSpy = vi.fn((id: string) => entries.get(id));
const disposeSpy = vi.fn();

vi.mock('../terminal-cache', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getOrCreate: (id: string) => (getOrCreateSpy as any)(id),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getCachedTerminal: (id: string) => (getCachedTerminalSpy as any)(id),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  disposeCachedTerminal: (id: string) => (disposeSpy as any)(id),
}));

import { TerminalInstance } from '../TerminalInstance';
// Real module — this is the integration under test, not a collaborator to mock.
import { requestTerminalFocus } from '../terminal-focus';

afterEach(() => {
  cleanup();
  // Drain whatever is pending so it can't leak into the next test. No test in
  // this file uses '__unclaimed__' as a terminalId, so this never gets claimed.
  requestTerminalFocus('__unclaimed__');
});

describe('TerminalInstance', () => {
  it('renders a container with the scoped data-testid', () => {
    render(<TerminalInstance terminalId="abc" visible />);
    expect(screen.getByTestId('run-terminal-abc')).toBeInTheDocument();
  });

  it('mounts the cached wrapper into its container', () => {
    render(<TerminalInstance terminalId="abc" visible />);
    expect(getOrCreateSpy).toHaveBeenCalledWith('abc');
    expect(screen.getByTestId('run-terminal-abc').contains(entries.get('abc')!.wrapper)).toBe(true);
  });

  it('does NOT dispose the cache on unmount (output preserved)', () => {
    const { unmount } = render(<TerminalInstance terminalId="abc" visible />);
    unmount();
    expect(disposeSpy).not.toHaveBeenCalled();
  });

  describe('focus requests', () => {
    it('does NOT focus when merely mounted visible with no pending request (regression guard: session switches / surface reveals must not steal focus from the composer)', () => {
      render(<TerminalInstance terminalId="reg-guard" visible />);
      expect(entries.get('reg-guard')!.term.focus).not.toHaveBeenCalled();
    });

    it('focuses a terminal mounted visible with a pending request, and consumes the request so a second mount does not re-focus', () => {
      requestTerminalFocus('claim-me');
      const { unmount } = render(<TerminalInstance terminalId="claim-me" visible />);
      const focus = entries.get('claim-me')!.term.focus;
      expect(focus).toHaveBeenCalledTimes(1);

      unmount();
      render(<TerminalInstance terminalId="claim-me" visible />);
      expect(focus).toHaveBeenCalledTimes(1);
    });

    it('focuses an already-mounted, already-visible terminal when a request arrives (pill click on the active tab)', () => {
      render(<TerminalInstance terminalId="already-active" visible />);
      const focus = entries.get('already-active')!.term.focus;
      expect(focus).not.toHaveBeenCalled();

      requestTerminalFocus('already-active');
      expect(focus).toHaveBeenCalledTimes(1);
    });

    it('does not focus a different terminal than the one requested', () => {
      render(<TerminalInstance terminalId="term-a" visible />);
      render(<TerminalInstance terminalId="term-b" visible />);

      requestTerminalFocus('term-a');

      expect(entries.get('term-a')!.term.focus).toHaveBeenCalledTimes(1);
      expect(entries.get('term-b')!.term.focus).not.toHaveBeenCalled();
    });

    it('does not claim a pending request while hidden; claims it once it becomes visible', () => {
      requestTerminalFocus('hidden-then-visible');
      const { rerender } = render(<TerminalInstance terminalId="hidden-then-visible" visible={false} />);
      const focus = entries.get('hidden-then-visible')!.term.focus;
      expect(focus).not.toHaveBeenCalled();

      rerender(<TerminalInstance terminalId="hidden-then-visible" visible />);
      expect(focus).toHaveBeenCalledTimes(1);
    });
  });
});

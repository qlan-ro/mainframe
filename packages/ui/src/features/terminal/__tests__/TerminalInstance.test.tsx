import { render, screen, cleanup } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';

const fitSpy = vi.fn();
const wrapper = document.createElement('div');
const getOrCreateSpy = vi.fn(() => ({ wrapper, term: {}, fitAddon: { fit: fitSpy }, disposers: [] }));
const disposeSpy = vi.fn();

vi.mock('../terminal-cache', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getOrCreate: (id: string) => (getOrCreateSpy as any)(id),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  disposeCachedTerminal: (id: string) => (disposeSpy as any)(id),
}));

import { TerminalInstance } from '../TerminalInstance';

afterEach(() => cleanup());

describe('TerminalInstance', () => {
  it('renders a container with the scoped data-testid', () => {
    render(<TerminalInstance terminalId="abc" visible />);
    expect(screen.getByTestId('run-terminal-abc')).toBeInTheDocument();
  });

  it('mounts the cached wrapper into its container', () => {
    render(<TerminalInstance terminalId="abc" visible />);
    expect(getOrCreateSpy).toHaveBeenCalledWith('abc');
    expect(screen.getByTestId('run-terminal-abc').contains(wrapper)).toBe(true);
  });

  it('does NOT dispose the cache on unmount (output preserved)', () => {
    const { unmount } = render(<TerminalInstance terminalId="abc" visible />);
    unmount();
    expect(disposeSpy).not.toHaveBeenCalled();
  });
});

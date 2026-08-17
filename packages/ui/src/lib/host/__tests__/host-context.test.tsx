import { describe, it, expect, afterEach } from 'vitest';
import { render, renderHook, screen } from '@testing-library/react';
import { FakeHostBridge } from '../fake-adapter';
import { getHost, setHostForTesting, resetHostForTesting, HostProvider, useHost } from '../index';

afterEach(() => {
  resetHostForTesting();
});

describe('getHost — singleton in browser/dev mode', () => {
  it('returns a FakeHostBridge when not under Tauri', () => {
    expect(getHost()).toBeInstanceOf(FakeHostBridge);
  });

  it('returns the same instance across calls', () => {
    expect(getHost()).toBe(getHost());
  });

  it('setHostForTesting overrides the singleton', () => {
    const fake = new FakeHostBridge({ app: { platform: 'macos' } });
    setHostForTesting(fake);
    expect(getHost()).toBe(fake);
  });
});

describe('useHost — reads the provided host', () => {
  it('returns the host passed to HostProvider', () => {
    const fake = new FakeHostBridge({ daemon: { port: 31500 } });
    const { result } = renderHook(() => useHost(), {
      wrapper: ({ children }) => <HostProvider host={fake}>{children}</HostProvider>,
    });
    expect(result.current).toBe(fake);
  });

  it('falls back to getHost() when no host prop is given', () => {
    function Probe() {
      const host = useHost();
      return <span data-testid="is-fake">{String(host instanceof FakeHostBridge)}</span>;
    }
    render(
      <HostProvider>
        <Probe />
      </HostProvider>,
    );
    expect(screen.getByTestId('is-fake').textContent).toBe('true');
  });
});

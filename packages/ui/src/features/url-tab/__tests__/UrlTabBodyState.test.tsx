/**
 * UrlTabBodyState — one explicit body per resolved `UrlTabTarget` (#281, Task 1).
 * Pure render tests: no store, no host, a bare `createRef` anchor.
 */
import { createRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { UrlTabBodyState } from '../UrlTabBodyState';
import type { UrlTabTarget } from '../resolve-url-target';

function renderBody(target: UrlTabTarget, overrides: { device?: 'desktop' | 'mobile'; inspectActive?: boolean } = {}) {
  const anchorRef = createRef<HTMLDivElement>();
  const onRetry = vi.fn();
  const { unmount } = render(
    <UrlTabBodyState
      target={target}
      device={overrides.device ?? 'desktop'}
      inspectActive={overrides.inspectActive ?? false}
      anchorRef={anchorRef}
      onRetry={onRetry}
    />,
  );
  return { anchorRef, onRetry, unmount };
}

describe('UrlTabBodyState', () => {
  it.each<[UrlTabTarget['kind'], UrlTabTarget]>([
    ['direct', { kind: 'direct', url: 'http://localhost:5173/' }],
    ['tunnelled', { kind: 'tunnelled', url: 'https://abc.trycloudflare.com/' }],
  ])('renders url-tab-body-loaded for a %s target, desktop and mobile', (_kind, target) => {
    const { unmount } = render(
      <UrlTabBodyState
        target={target}
        device="desktop"
        inspectActive={false}
        anchorRef={createRef<HTMLDivElement>()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByTestId('url-tab-body-loaded')).toBeInTheDocument();
    unmount();

    render(
      <UrlTabBodyState
        target={target}
        device="mobile"
        inspectActive={false}
        anchorRef={createRef<HTMLDivElement>()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByTestId('url-tab-body-loaded')).toBeInTheDocument();
  });

  it('shows the inspect-active indicator only when inspectActive is true on a loaded body', () => {
    const target: UrlTabTarget = { kind: 'direct', url: 'http://localhost:5173/' };

    const { unmount } = renderBody(target, { inspectActive: true });
    expect(screen.getByTestId('url-tab-inspect-active-indicator')).toBeInTheDocument();
    unmount();

    renderBody(target, { inspectActive: false });
    expect(screen.queryByTestId('url-tab-inspect-active-indicator')).toBeNull();
  });

  it('renders the pending body naming the port, with no retry', () => {
    renderBody({ kind: 'pending', port: 5173 });

    const body = screen.getByTestId('url-tab-body-pending');
    expect(body.textContent).toContain('5173');
    expect(screen.queryByTestId('url-tab-retry')).toBeNull();
  });

  it('renders the rejected body with the reason verbatim and no retry (AC10)', () => {
    renderBody({ kind: 'rejected', port: 22, reason: 'Port must be 1024 or higher' });

    const body = screen.getByTestId('url-tab-body-rejected');
    expect(body.textContent).toContain('Port must be 1024 or higher');
    expect(screen.queryByTestId('url-tab-retry')).toBeNull();
  });

  it('renders the failed body with the error text and a working retry (AC9)', () => {
    const { onRetry } = renderBody({ kind: 'failed', error: 'cloudflared exited with code 1' });

    const body = screen.getByTestId('url-tab-body-failed');
    expect(body.textContent).toContain('cloudflared exited with code 1');

    const retry = screen.getByTestId('url-tab-retry');
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders the stopped body naming the port, with a working retry', () => {
    const { onRetry } = renderBody({ kind: 'stopped', port: 5173 });

    const body = screen.getByTestId('url-tab-body-stopped');
    expect(body.textContent).toContain('5173');

    fireEvent.click(screen.getByTestId('url-tab-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders the blank body for an empty url — a ⌘T tab, not a broken one', () => {
    renderBody({ kind: 'invalid', url: '' });

    const body = screen.getByTestId('url-tab-body-blank');
    expect(body).toBeInTheDocument();
    expect(body).toHaveTextContent('Type an address above to open a page');
    expect(screen.queryByTestId('url-tab-body-invalid')).toBeNull();
    expect(body.querySelector('.font-mono')).toBeNull();
    expect(screen.queryByTestId('url-tab-retry')).toBeNull();
  });

  it('renders the invalid body with the offending text for a non-empty url, and no retry', () => {
    renderBody({ kind: 'invalid', url: 'not a url' });

    expect(screen.getByTestId('url-tab-body-invalid')).toBeInTheDocument();
    expect(screen.getByText('not a url')).toBeInTheDocument();
    expect(screen.queryByTestId('url-tab-retry')).toBeNull();
  });
});

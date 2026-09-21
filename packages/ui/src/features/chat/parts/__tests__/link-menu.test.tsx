/**
 * Todo #341 — link menu parity. Two things this file pins down for the
 * plain-link (`LinkWithPreview`) menu that `url-chip-menu.test.tsx` already
 * pins for the chip:
 *   1. `httpLinkHref` — the in-app row's scheme gate, tested directly.
 *   2. The rendered menu: row set + order, the in-app row's single emission
 *      with no external open and no tunnel start, and the non-http(s) omission.
 *
 * New file (not appended to `markdown-text.test.tsx`, already at the 300-line
 * cap) — see docs/plans/2026-09-20-todo-341-link-menu-parity-plan.md.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { HostProvider } from '@/lib/host';
import { FakeHostBridge } from '@/lib/host/fake-adapter';
import { httpLinkHref } from '../link-menu-actions';

const emitSurfaceIntent = vi.fn();
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: (intent: unknown) => emitSurfaceIntent(intent) }));

const startPortTunnel = vi.fn();
vi.mock('@/lib/api/tunnel-ports', () => ({
  startPortTunnel: (port: number, body: unknown) => startPortTunnel(port, body),
  stopPortTunnel: vi.fn(),
  listPortTunnels: vi.fn(),
}));

import { markdownComponents } from '../markdown-text';

const A = markdownComponents.a as React.ComponentType<React.AnchorHTMLAttributes<HTMLAnchorElement>>;

let fake: FakeHostBridge;

function renderLink(href: string) {
  fake = new FakeHostBridge();
  vi.spyOn(fake.shell, 'openExternal').mockResolvedValue(undefined);
  render(
    <HostProvider host={fake}>
      <TooltipProvider>
        <A href={href}>link text</A>
      </TooltipProvider>
    </HostProvider>,
  );
  fireEvent.contextMenu(screen.getByRole('link', { name: 'link text' }));
}

beforeEach(() => {
  emitSurfaceIntent.mockReset();
  startPortTunnel.mockReset();
});

describe('httpLinkHref', () => {
  it.each([
    ['https://example.com', 'https://example.com'],
    ['http://localhost:5173/app', 'http://localhost:5173/app'],
  ])('accepts %s', (href, expected) => {
    expect(httpLinkHref(href)).toBe(expected);
  });

  it.each([['mailto:a@b.com'], ['/docs'], ['README.md'], [undefined]])('rejects %s', (href) => {
    expect(httpLinkHref(href)).toBeNull();
  });
});

describe('LinkWithPreview link menu (todo #341)', () => {
  it('lists Open in Mainframe, then Open in browser, then Copy link for an http(s) link', () => {
    renderLink('https://example.com');

    const inApp = screen.getByTestId('chat-link-open-in-app');
    const browser = screen.getByTestId('chat-link-open');
    const copy = screen.getByTestId('chat-link-copy');

    expect(inApp.compareDocumentPosition(browser) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(browser.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(inApp).toHaveTextContent('Open in Mainframe');
    expect(browser).toHaveTextContent('Open in browser');
  });

  it('the in-app row emits one open-url-tab intent with the href and starts no tunnel or external open', () => {
    renderLink('https://example.com');

    fireEvent.click(screen.getByTestId('chat-link-open-in-app'));

    expect(emitSurfaceIntent).toHaveBeenCalledTimes(1);
    expect(emitSurfaceIntent).toHaveBeenCalledWith({ type: 'open-url-tab', url: 'https://example.com' });
    expect(startPortTunnel).not.toHaveBeenCalled();
    expect(fake.shell.openExternal).not.toHaveBeenCalled();
  });

  it('omits the in-app row for a non-http(s) href, keeping copy and external open', () => {
    renderLink('mailto:a@b.com');

    expect(screen.queryByTestId('chat-link-open-in-app')).toBeNull();
    expect(screen.getByTestId('chat-link-open')).toBeInTheDocument();
    expect(screen.getByTestId('chat-link-copy')).toBeInTheDocument();
  });
});

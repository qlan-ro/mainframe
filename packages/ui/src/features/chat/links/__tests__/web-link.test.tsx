/**
 * A web link (T1d, #341): where a click opens it, and its context menu.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { HostProvider } from '@/lib/host';
import { useUiPrefs } from '@/store/ui-prefs';
import { FakeHostBridge } from '@/lib/host/fake-adapter';
import { httpLinkHref } from '../../parts/link-menu-actions';

const emitSurfaceIntent = vi.fn();
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: (intent: unknown) => emitSurfaceIntent(intent) }));

const startPortTunnel = vi.fn();
const prepareArtifactPreview = vi.fn();
vi.mock('@/lib/api/artifacts', () => ({ prepareArtifactPreview: (url: string) => prepareArtifactPreview(url) }));
vi.mock('@/lib/api/tunnel-ports', () => ({
  startPortTunnel: (port: number, body: unknown) => startPortTunnel(port, body),
  stopPortTunnel: vi.fn(),
  listPortTunnels: vi.fn(),
}));

import { markdownComponents } from '../../parts/markdown-text';

const A = markdownComponents.a as React.ComponentType<React.AnchorHTMLAttributes<HTMLAnchorElement>>;

let fake: FakeHostBridge;

function mountLink(href: string) {
  fake = new FakeHostBridge();
  vi.spyOn(fake.shell, 'openExternal').mockResolvedValue(undefined);
  render(
    <HostProvider host={fake}>
      <TooltipProvider>
        <A href={href}>link text</A>
      </TooltipProvider>
    </HostProvider>,
  );
}

function renderLink(href: string) {
  mountLink(href);
  fireEvent.contextMenu(screen.getByRole('link', { name: 'link text' }));
}

beforeEach(() => {
  emitSurfaceIntent.mockReset();
  startPortTunnel.mockReset();
  useUiPrefs.setState({ openLinksIn: 'workspace' });
});

describe('artifact links', () => {
  const ARTIFACT = 'https://claude.ai/artifact/V1LAdjrXoKC7jVLpHnV1D2';
  const READY = { status: 'ready', path: '/api/artifact-preview/V1/179/index', title: 'Coffee Pricing' };

  beforeEach(() => {
    prepareArtifactPreview.mockReset();
    prepareArtifactPreview.mockResolvedValue(READY);
  });

  it('opens the local preview, not claude.ai, on a plain click', async () => {
    mountLink(ARTIFACT);
    fireEvent.click(screen.getByRole('link', { name: 'link text' }));

    // The fake host has no webview, so the preview opens as a browser tab.
    await vi.waitFor(() => expect(fake.shell.openExternal).toHaveBeenCalledWith(expect.stringContaining(READY.path)));
    expect(prepareArtifactPreview).toHaveBeenCalledWith(ARTIFACT);
  });

  it('keeps Open in browser pointing at claude.ai', () => {
    renderLink(ARTIFACT);
    fireEvent.click(screen.getByTestId('chat-link-open'));

    expect(fake.shell.openExternal).toHaveBeenCalledWith(ARTIFACT);
    expect(prepareArtifactPreview).not.toHaveBeenCalled();
  });

  it('goes to claude.ai when links open in the browser', () => {
    useUiPrefs.setState({ openLinksIn: 'browser' });
    mountLink(ARTIFACT);
    fireEvent.click(screen.getByRole('link', { name: 'link text' }));
    expect(fake.shell.openExternal).toHaveBeenCalledWith(ARTIFACT);
    expect(prepareArtifactPreview).not.toHaveBeenCalled();
  });
});

describe('Open links in', () => {
  it('opens a workspace tab by default', () => {
    mountLink('https://example.com');
    fireEvent.click(screen.getByRole('link', { name: 'link text' }));
    expect(emitSurfaceIntent).toHaveBeenCalledWith({ type: 'open-url-tab', url: 'https://example.com' });
    expect(fake.shell.openExternal).not.toHaveBeenCalled();
  });

  it('opens the browser when the setting says so', () => {
    useUiPrefs.setState({ openLinksIn: 'browser' });
    mountLink('https://example.com');
    fireEvent.click(screen.getByRole('link', { name: 'link text' }));
    expect(fake.shell.openExternal).toHaveBeenCalledWith('https://example.com');
    expect(emitSurfaceIntent).not.toHaveBeenCalled();
  });

  it('hands a link the workspace cannot show to the system', () => {
    mountLink('mailto:a@b.com');
    fireEvent.click(screen.getByRole('link', { name: 'link text' }));
    expect(fake.shell.openExternal).toHaveBeenCalledWith('mailto:a@b.com');
  });
});

describe('footnotes', () => {
  it('jump to their note inside the same reply', () => {
    Element.prototype.scrollIntoView = vi.fn();
    render(
      <>
        <div className="aui-md">
          <p id="user-content-fn-1">Another reply’s note</p>
        </div>
        <div className="aui-md">
          <A href="#user-content-fn-1">1</A>
          <p id="user-content-fn-1">This reply’s note</p>
        </div>
      </>,
    );
    fireEvent.click(screen.getByRole('link', { name: '1' }));
    expect(screen.getByText('This reply’s note')).toHaveFocus();
  });
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

describe('the link menu (#341)', () => {
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

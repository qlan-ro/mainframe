/**
 * HtmlEditorTab tests.
 *
 * Behaviors covered:
 *  1. Opens in Preview: a sandboxed srcdoc iframe renders the buffer value.
 *  2. Source shows the editor over the same value; Preview returns to the iframe.
 *  3. "Open in browser" opens the file on disk with its default app, resolving
 *     a relative path against the active workspace base.
 *  4. "Open in browser" is disabled under a remote daemon.
 *  5. The footer reports the HTML size.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render as rtlRender, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { HostProvider } from '@/lib/host';
import { FakeHostBridge } from '@/lib/host/fake-adapter';
import { useActiveBasesStore } from '@/store/active-bases-store';
import { HtmlEditorTab } from '../HtmlEditorTab';

let daemonIsLocal = true;
vi.mock('@/lib/daemon/use-daemon-is-local', () => ({ useDaemonIsLocal: () => daemonIsLocal }));
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: vi.fn() }));
// useFileTabNotes -> useSendReview reads these contexts; neither provider is mounted.
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));
vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({ projectId: undefined, chatId: undefined, projectPath: undefined }),
}));

type CmProps = ComponentProps<typeof import('../inline-comments/CmEditorWithComments').CmEditorWithComments>;
vi.mock('../inline-comments/CmEditorWithComments', () => ({
  CmEditorWithComments: (props: CmProps) => (
    <div data-testid="cm-editor-mock" data-language={props.language}>
      {props.value}
    </div>
  ),
}));

const HTML = '<html><body><h1>Hello</h1></body></html>';

let fakeHost: FakeHostBridge;

function renderTab(value = HTML) {
  return rtlRender(
    <HostProvider host={fakeHost}>
      <HtmlEditorTab value={value} path="site/index.html" onChange={vi.fn()} />
    </HostProvider>,
    { wrapper: TooltipProvider },
  );
}

beforeEach(() => {
  daemonIsLocal = true;
  useActiveBasesStore.setState({ bases: { projectPath: '/Users/me/proj' } });
  fakeHost = new FakeHostBridge();
  vi.spyOn(fakeHost.fs, 'openPath').mockResolvedValue(undefined);
});

describe('HtmlEditorTab', () => {
  it('opens in Preview with the buffer rendered in a fully sandboxed srcdoc iframe', () => {
    renderTab();
    const frame = screen.getByTestId('html-preview-frame');
    expect(frame.getAttribute('srcdoc')).toBe(HTML);
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(screen.queryByTestId('cm-editor-mock')).toBeNull();
  });

  it('switches to the html editor on Source and back to the iframe on Preview', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(screen.getByTestId('html-mode-edit'));
    const editor = screen.getByTestId('cm-editor-mock');
    expect(editor).toHaveTextContent(HTML);
    expect(editor).toHaveAttribute('data-language', 'html');
    expect(screen.queryByTestId('html-preview-frame')).toBeNull();

    await user.click(screen.getByTestId('html-mode-preview'));
    expect(screen.getByTestId('html-preview-frame')).toBeInTheDocument();
  });

  it('opens the file on disk in the default browser', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(screen.getByTestId('html-open-in-browser'));
    expect(fakeHost.fs.openPath).toHaveBeenCalledWith('/Users/me/proj/site/index.html');
  });

  it('disables Open in browser when the daemon is remote', () => {
    daemonIsLocal = false;
    renderTab();
    expect(screen.getByTestId('html-open-in-browser')).toBeDisabled();
  });

  it('reports the HTML size in the footer', () => {
    renderTab(`<p>${'x'.repeat(2041)}</p>`);
    expect(screen.getByTestId('viewer-shell-status')).toHaveTextContent('HTML · 2 KB');
  });
});

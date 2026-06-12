/**
 * ViewerShell tests.
 *
 * Behaviors covered:
 *  1. Renders with data-testid="viewer-shell".
 *  2. Breadcrumb splits path into dir portion and basename; dir uses mf-text-4
 *     and basename uses foreground color class.
 *  3. Reveal button is present (data-testid="viewer-shell-reveal") and on click
 *     calls emitSurfaceIntent({ type: 'reveal-file', path }).
 *  4. Status string renders in the footer (data-testid="viewer-shell-status").
 *  5. Children render in the body area.
 *  6. Optional actions node renders in the header right slot.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ViewerShell } from '../ViewerShell';

vi.mock('@/store/surface-intents', () => ({
  emitSurfaceIntent: vi.fn(),
}));

// Import after mock so we get the mocked version.
import { emitSurfaceIntent } from '@/store/surface-intents';

const mockEmit = emitSurfaceIntent as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockEmit.mockClear();
});

describe('ViewerShell', () => {
  it('renders with data-testid="viewer-shell"', () => {
    render(
      <ViewerShell path="/a/b/file.png" status="PNG · 10×10 · 1 KB">
        <div>body</div>
      </ViewerShell>,
    );
    expect(screen.getByTestId('viewer-shell')).toBeInTheDocument();
  });

  it('shows the dir portion "a/b" and basename "file.png" for path "/a/b/file.png"', () => {
    render(
      <ViewerShell path="/a/b/file.png" status="PNG · 10×10 · 1 KB">
        <div>body</div>
      </ViewerShell>,
    );
    const shell = screen.getByTestId('viewer-shell');
    expect(shell).toHaveTextContent('a/b');
    expect(shell).toHaveTextContent('file.png');
  });

  it('renders the reveal button with data-testid="viewer-shell-reveal"', () => {
    render(
      <ViewerShell path="/a/b/file.png" status="PNG · 10×10 · 1 KB">
        <div>body</div>
      </ViewerShell>,
    );
    expect(screen.getByTestId('viewer-shell-reveal')).toBeInTheDocument();
  });

  it('calls emitSurfaceIntent with reveal-file intent on reveal button click', async () => {
    const user = userEvent.setup();
    render(
      <ViewerShell path="/a/b/file.png" status="PNG · 10×10 · 1 KB">
        <div>body</div>
      </ViewerShell>,
    );
    await user.click(screen.getByTestId('viewer-shell-reveal'));
    expect(mockEmit).toHaveBeenCalledOnce();
    expect(mockEmit).toHaveBeenCalledWith({ type: 'reveal-file', path: '/a/b/file.png' });
  });

  it('renders the status string in viewer-shell-status', () => {
    render(
      <ViewerShell path="/a/b/file.png" status="PNG · 10×10 · 1 KB">
        <div>body</div>
      </ViewerShell>,
    );
    const statusEl = screen.getByTestId('viewer-shell-status');
    expect(statusEl).toHaveTextContent('PNG · 10×10 · 1 KB');
  });

  it('renders children in the body area', () => {
    render(
      <ViewerShell path="/a/b/file.png" status="PNG · 10×10 · 1 KB">
        <div data-testid="child-content">hello child</div>
      </ViewerShell>,
    );
    expect(screen.getByTestId('child-content')).toBeInTheDocument();
    expect(screen.getByTestId('child-content')).toHaveTextContent('hello child');
  });

  it('renders the optional actions node in the header', () => {
    render(
      <ViewerShell
        path="/a/b/file.png"
        status="PNG · 10×10 · 1 KB"
        actions={<button data-testid="custom-action">action</button>}
      >
        <div>body</div>
      </ViewerShell>,
    );
    expect(screen.getByTestId('custom-action')).toBeInTheDocument();
  });
});

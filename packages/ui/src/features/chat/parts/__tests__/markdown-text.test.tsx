/**
 * Behavior tests for the `markdownComponents.a` (LinkWithPreview) component.
 *
 * Behaviors covered:
 *  1. Smoke test — the nested Tooltip+ContextMenu asChild composition does NOT
 *     crash and the anchor is rendered with the correct text and href.
 *  2. Click — calls openExternal with the href and prevents default navigation.
 *
 * Context-menu open path (right-click → items visible):
 *   Radix ContextMenu uses portals and pointer events that do not fire reliably
 *   under jsdom. This assertion is intentionally omitted; the context-menu open
 *   path is covered manually.
 *
 * Mock strategy: render under HostProvider with a FakeHostBridge; spy on
 * fake.shell.openExternal to verify behavioral calls without invoking Tauri APIs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useUiPrefs } from '@/store/ui-prefs';
import { HostProvider } from '@/lib/host';
import { FakeHostBridge } from '@/lib/host/fake-adapter';

// Import the component under test (no bridge mock needed — HostProvider provides the host).
import { markdownComponents, MARKDOWN_ROOT_CLASS } from '../markdown-text';
import { MessagePathContextMenu } from '@/features/chat/messages/MessagePathContextMenu';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let fake: FakeHostBridge;

function wrap(ui: React.ReactElement) {
  fake = new FakeHostBridge();
  vi.spyOn(fake.shell, 'openExternal').mockResolvedValue(undefined);
  return render(
    <HostProvider host={fake}>
      <TooltipProvider>{ui}</TooltipProvider>
    </HostProvider>,
  );
}

// Assign markdownComponents.a to a named variable so JSX can reference it.
const A = markdownComponents.a as React.ComponentType<React.AnchorHTMLAttributes<HTMLAnchorElement>>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('markdownComponents.a (LinkWithPreview)', () => {
  // -------------------------------------------------------------------------
  // 1. Smoke — nested Tooltip+ContextMenu composition does not crash; anchor
  //    is rendered with the correct text and href.
  // -------------------------------------------------------------------------

  it('renders an anchor with the given href and text without throwing', () => {
    wrap(<A href="https://example.com">link text</A>);

    const anchor = screen.getByRole('link', { name: 'link text' });
    expect(anchor).toBeInTheDocument();
    expect(anchor).toHaveAttribute('href', 'https://example.com');
  });

  // -------------------------------------------------------------------------
  // 2. Click — opens where the setting says; default navigation is prevented.
  // -------------------------------------------------------------------------

  it('a click opens the link itself, without navigating the app', () => {
    useUiPrefs.setState({ openLinksIn: 'browser' });
    wrap(<A href="https://example.com">link text</A>);
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    screen.getByRole('link', { name: 'link text' }).dispatchEvent(clickEvent);
    expect(fake.shell.openExternal).toHaveBeenCalledTimes(1);
    expect(fake.shell.openExternal).toHaveBeenCalledWith('https://example.com');
    expect(clickEvent.defaultPrevented).toBe(true);
    useUiPrefs.setState({ openLinksIn: 'workspace' });
  });
});

// ---------------------------------------------------------------------------
// Task-list checkbox (remark-gfm) — bespoke checkbox visual, not raw <input>.
// ---------------------------------------------------------------------------

const Li = markdownComponents.li as React.ComponentType<React.LiHTMLAttributes<HTMLLIElement> & { className?: string }>;
const MdInput = (markdownComponents as Record<string, unknown>).input as
  React.ComponentType<React.InputHTMLAttributes<HTMLInputElement>> | undefined;

describe('markdownComponents task-list checkbox', () => {
  it('renders a checked-state checkbox with the custom checkbox class, not a bare native checkbox', () => {
    expect(MdInput).toBeDefined();
    const Comp = MdInput as React.ComponentType<React.InputHTMLAttributes<HTMLInputElement>>;
    const { container } = render(<Comp type="checkbox" checked readOnly disabled />);
    const box = container.querySelector('[data-slot="md-task-checkbox"]');
    expect(box).not.toBeNull();
    expect(box!.getAttribute('data-checked')).toBe('true');
  });

  it('unchecked task item renders data-checked="false"', () => {
    const Comp = MdInput as React.ComponentType<React.InputHTMLAttributes<HTMLInputElement>>;
    const { container } = render(<Comp type="checkbox" checked={false} readOnly disabled />);
    const box = container.querySelector('[data-slot="md-task-checkbox"]');
    expect(box!.getAttribute('data-checked')).toBe('false');
  });

  it('a done task-list <li> strikes its label through, an ordinary one does not', () => {
    const item = (className?: string) => {
      const { container } = render(
        <ul>
          <Li className={className}>thing</Li>
        </ul>,
      );
      return container.querySelector('li')!.className;
    };
    expect(item('task-list-item')).toMatch(/has-\[.*data-checked=true.*\]:line-through/);
    expect(item()).not.toContain('line-through');
  });

  it('says each state to assistive tech, and is not a control', () => {
    const Comp = MdInput as React.ComponentType<React.InputHTMLAttributes<HTMLInputElement>>;
    const { container } = render(
      <>
        <Comp type="checkbox" checked readOnly disabled />
        <Comp type="checkbox" checked={false} readOnly disabled />
      </>,
    );
    expect(container).toHaveTextContent('Done: Not done:');
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Regression: MarkdownLi must use normal block flow, not `flex`, so mixed
// inline children (text + <code> chips + <strong> + links) wrap and flow as
// text instead of being laid out as separate flex items side by side.
// See docs/design-reference/prototype/08-markdown.jsx:135-153.
// ---------------------------------------------------------------------------

describe('markdownComponents list item flow (regression: no flex on li)', () => {
  it('MarkdownLi does not use flex layout classes', () => {
    const { container } = render(<Li>item</Li>);
    const li = container.querySelector('li');
    expect(li!.className).not.toContain('flex');
    expect(li!.className).not.toContain('items-baseline');
  });

  it('renders mixed inline children (text + code + text) inside a single flow container, not separate flex items', () => {
    const { container } = render(
      <ul>
        <Li>
          before text <code>inline code</code> after text
        </Li>
      </ul>,
    );
    const li = container.querySelector('li')!;
    expect(li.className).not.toContain('flex');
    // All children remain direct content of the single <li> flow container —
    // no wrapping flex-item divs were introduced around the inline runs.
    expect(li.textContent).toBe('before text inline code after text');
    expect(li.querySelector('code')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Markdown body tracking — v1's uniform `tracking-tight` was a warm-chrome
// choice; v2 prose runs at the stock tracking its 13px body rung was measured
// for, so the root class only marks the prose container.
// ---------------------------------------------------------------------------

describe('MarkdownText container tracking', () => {
  it('exports MARKDOWN_ROOT_CLASS marking the prose container, with no tracking override', () => {
    expect(MARKDOWN_ROOT_CLASS).toContain('aui-md');
    expect(MARKDOWN_ROOT_CLASS).not.toContain('tracking-');
  });
});

// ---------------------------------------------------------------------------
// Copy-link context-menu item — visible "Copied" feedback (todo #230).
// Radix closes a ContextMenuItem's menu immediately on select by default, so
// the item must preventDefault, show feedback, then close itself on a delay.
// ---------------------------------------------------------------------------

describe('link context-menu copy feedback', () => {
  // NOTE: deliberately uses fireEvent, not userEvent — userEvent.setup()
  // installs its own real clipboard stub on `navigator.clipboard`, silently
  // shadowing the mock this suite defines below (confirmed by direct
  // reproduction: userEvent.click left our `writeText` mock with 0 calls
  // while fireEvent.click hit it correctly).
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    writeText.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function openContextMenu() {
    wrap(<A href="https://example.com">link text</A>);
    fireEvent.contextMenu(screen.getByRole('link', { name: 'link text' }));
  }

  /** Lets the clipboard promise settle so the copy feedback lands. */
  async function flushCopy(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('renders "Copy link" before the item is selected', () => {
    openContextMenu();
    expect(screen.getByTestId('chat-link-copy').textContent).toContain('Copy link');
  });

  it('writes the href to the clipboard and swaps the label to "Copied" when selected', async () => {
    openContextMenu();

    fireEvent.click(screen.getByTestId('chat-link-copy'));
    await flushCopy();

    expect(writeText).toHaveBeenCalledWith('https://example.com');
    expect(screen.getByTestId('chat-link-copy').textContent).toContain('Copied');
  });

  it('reads "Copy failed" when the clipboard write is rejected', async () => {
    writeText.mockRejectedValueOnce(new Error('document is not focused'));
    openContextMenu();

    fireEvent.click(screen.getByTestId('chat-link-copy'));
    await flushCopy();

    const item = screen.getByTestId('chat-link-copy');
    expect(item.textContent).toContain('Copy failed');
    expect(item.textContent).not.toContain('Copied');
  });

  it('keeps the menu open right after selecting Copy link (no immediate close)', () => {
    openContextMenu();

    fireEvent.click(screen.getByTestId('chat-link-copy'));

    expect(screen.queryByTestId('chat-link-copy')).not.toBeNull();
  });

  it('closes the menu itself shortly after showing the "Copied" feedback', async () => {
    openContextMenu();

    fireEvent.click(screen.getByTestId('chat-link-copy'));
    await flushCopy();
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByTestId('chat-link-copy')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Link menu wins innermost (274-A8) — right-clicking a link inside a message
// wrapped in MessagePathContextMenu must open only the link's own menu.
// ---------------------------------------------------------------------------

describe('LinkWithPreview inside MessagePathContextMenu — link menu wins innermost', () => {
  it('right-clicking the link opens only the link menu, not the outer path menu', () => {
    wrap(
      <MessagePathContextMenu>
        <A href="https://example.com">link text</A>
      </MessagePathContextMenu>,
    );

    fireEvent.contextMenu(screen.getByRole('link', { name: 'link text' }));

    expect(screen.getByTestId('chat-link-copy')).toBeInTheDocument();
    expect(screen.getByTestId('chat-link-open')).toBeInTheDocument();
    expect(screen.queryByTestId('tool-card-path-copy-absolute')).toBeNull();
  });
});

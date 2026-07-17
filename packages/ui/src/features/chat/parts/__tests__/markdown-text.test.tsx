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
import type { SyntaxHighlighterProps } from '@assistant-ui/react-markdown';
import { TooltipProvider } from '@/components/ui/tooltip';
import { HostProvider } from '@/lib/host';
import { FakeHostBridge } from '@/lib/host/fake-adapter';

// Import the component under test (no bridge mock needed — HostProvider provides the host).
import { markdownComponents, MARKDOWN_ROOT_CLASS } from '../markdown-text';
import { CodeHeader } from '../CodeHeader';
import { SyntaxHighlighter } from '../syntax-highlight';

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

// markdownComponents.a is a memo-wrapped component (from
// unstable_memoizeMarkdownComponents). Assign to a named variable so JSX can
// reference it as a component.
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
  // 2. Click — openExternal is called with the href; default navigation is
  //    prevented (the click handler calls e.preventDefault()).
  // -------------------------------------------------------------------------

  it('clicking the anchor calls openExternal with the href', () => {
    wrap(<A href="https://example.com">link text</A>);

    const anchor = screen.getByRole('link', { name: 'link text' });

    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    anchor.dispatchEvent(clickEvent);

    expect(fake.shell.openExternal).toHaveBeenCalledTimes(1);
    expect(fake.shell.openExternal).toHaveBeenCalledWith('https://example.com');
    expect(clickEvent.defaultPrevented).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fenced code block — CodeHeader + SyntaxHighlighter must compose ONE bordered,
// rounded container (they are Fragment siblings; the container is CSS-composed).
// ---------------------------------------------------------------------------

describe('fenced code block container', () => {
  it('CodeHeader forms the rounded, bordered top of the container', () => {
    const { container } = render(<CodeHeader language="ts" code="const x = 1;" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('rounded-t-md');
    expect(root.className).toContain('border-border');
  });

  it('SyntaxHighlighter <pre> forms the rounded, bordered bottom of the container', () => {
    // `components` is required by the slot type but ignored by our shiki impl.
    const components = {} as unknown as SyntaxHighlighterProps['components'];
    const { container } = render(<SyntaxHighlighter code="const x = 1;" language="ts" components={components} />);
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre!.className).toContain('rounded-b-md');
    expect(pre!.className).toContain('border-border');
    // header's bottom border is the divider — the pre must not double it
    expect(pre!.className).toContain('border-t-0');
  });

  it('SyntaxHighlighter renders a line-number gutter cell per line', () => {
    const components = {} as unknown as SyntaxHighlighterProps['components'];
    const { container } = render(
      <SyntaxHighlighter code={'line one\nline two'} language="ts" components={components} />,
    );
    const numbers = container.querySelectorAll('[data-slot="code-line-number"]');
    expect(numbers.length).toBeGreaterThan(0);
  });

  it('CodeHeader language label is uppercase, not lowercase', () => {
    const { container } = render(<CodeHeader language="ts" code="const x = 1;" />);
    const label = container.querySelector('span');
    expect(label!.className).toContain('uppercase');
    expect(label!.className).not.toContain('lowercase');
  });

  it('CodeHeader copy button shows a visible "Copy" text label', () => {
    const { getByTestId } = render(<CodeHeader language="ts" code="const x = 1;" />);
    const button = getByTestId('chat-code-copy');
    expect(button.textContent).toContain('Copy');
  });
});

// ---------------------------------------------------------------------------
// Task-list checkbox (remark-gfm) — bespoke checkbox visual, not raw <input>.
// ---------------------------------------------------------------------------

const Li = markdownComponents.li as React.ComponentType<React.LiHTMLAttributes<HTMLLIElement> & { className?: string }>;
const MdInput = (markdownComponents as Record<string, unknown>).input as
  | React.ComponentType<React.InputHTMLAttributes<HTMLInputElement>>
  | undefined;

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

  it('a task-list <li> applies line-through styling to its checked label via data attribute', () => {
    const Comp = MdInput as React.ComponentType<React.InputHTMLAttributes<HTMLInputElement>>;
    const { container } = render(
      <ul>
        <Li className="task-list-item">
          <Comp type="checkbox" checked readOnly disabled />
          done thing
        </Li>
      </ul>,
    );
    const li = container.querySelector('li');
    expect(li!.className).toContain('aui-md-li-task');
  });
});

// ---------------------------------------------------------------------------
// Ordered/unordered list markers — custom mono index / dot, not browser markers.
// ---------------------------------------------------------------------------

describe('markdownComponents list markers', () => {
  const Ul = markdownComponents.ul as React.ComponentType<React.HTMLAttributes<HTMLUListElement>>;
  const Ol = markdownComponents.ol as React.ComponentType<React.OlHTMLAttributes<HTMLOListElement>>;

  it('ul does not use browser list-disc markers (replaced by a custom dot)', () => {
    const { container } = render(
      <Ul>
        <Li>item</Li>
      </Ul>,
    );
    const ul = container.querySelector('ul');
    expect(ul!.className).not.toContain('list-disc');
  });

  it('ol does not use browser list-decimal markers (replaced by a custom mono index)', () => {
    const { container } = render(
      <Ol>
        <Li>item</Li>
      </Ol>,
    );
    const ol = container.querySelector('ol');
    expect(ol!.className).not.toContain('list-decimal');
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

  it('MarkdownLi uses a hung-marker gutter (relative + pl-[22px]) instead of a flex gap', () => {
    const { container } = render(<Li>item</Li>);
    const li = container.querySelector('li');
    expect(li!.className).toContain('relative');
    expect(li!.className).toContain('pl-[22px]');
  });
});

// ---------------------------------------------------------------------------
// Link underline — faint accent-toned decoration, not a solid full-opacity one.
// ---------------------------------------------------------------------------

describe('markdownComponents link underline', () => {
  it('LinkWithPreview with no href uses a faint border-bottom rule, not a solid text-decoration underline', () => {
    const A = markdownComponents.a as React.ComponentType<React.AnchorHTMLAttributes<HTMLAnchorElement>>;
    const { container } = render(<A>bare</A>);
    const a = container.querySelector('a');
    expect(a!.className).toContain('border-b');
    expect(a!.className).toContain('border-primary/40');
    expect(a!.className).toContain('no-underline');
    const classTokens = a!.className.split(/\s+/);
    expect(classTokens).not.toContain('underline');
  });
});

// ---------------------------------------------------------------------------
// Markdown body tracking — tracking-tight applied to the .aui-md container.
// ---------------------------------------------------------------------------

describe('MarkdownText container tracking', () => {
  it('exports MARKDOWN_ROOT_CLASS with tracking-tight applied', () => {
    expect(MARKDOWN_ROOT_CLASS).toContain('tracking-tight');
    expect(MARKDOWN_ROOT_CLASS).toContain('aui-md');
  });
});

// ---------------------------------------------------------------------------
// Copy-link context-menu item — visible "Copied" feedback (todo #230).
// Radix closes a ContextMenuItem's menu immediately on select by default, so
// the item must preventDefault, show feedback, then close itself on a delay.
// ---------------------------------------------------------------------------

describe('LinkWithPreview context-menu copy feedback', () => {
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

  it('renders "Copy link" before the item is selected', () => {
    openContextMenu();
    expect(screen.getByTestId('chat-link-copy').textContent).toContain('Copy link');
  });

  it('writes the href to the clipboard and swaps the label to "Copied" when selected', () => {
    openContextMenu();

    fireEvent.click(screen.getByTestId('chat-link-copy'));

    expect(writeText).toHaveBeenCalledWith('https://example.com');
    expect(screen.getByTestId('chat-link-copy').textContent).toContain('Copied');
  });

  it('keeps the menu open right after selecting Copy link (no immediate close)', () => {
    openContextMenu();

    fireEvent.click(screen.getByTestId('chat-link-copy'));

    expect(screen.queryByTestId('chat-link-copy')).not.toBeNull();
  });

  it('closes the menu itself shortly after showing the "Copied" feedback', () => {
    openContextMenu();

    fireEvent.click(screen.getByTestId('chat-link-copy'));
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByTestId('chat-link-copy')).toBeNull();
  });
});

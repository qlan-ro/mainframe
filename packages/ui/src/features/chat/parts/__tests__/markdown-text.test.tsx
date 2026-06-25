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
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SyntaxHighlighterProps } from '@assistant-ui/react-markdown';
import { TooltipProvider } from '@/components/ui/tooltip';
import { HostProvider } from '@/lib/host';
import { FakeHostBridge } from '@/lib/host/fake-adapter';

// Import the component under test (no bridge mock needed — HostProvider provides the host).
import { markdownComponents } from '../markdown-text';
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
// Markdown table — th/td must use sans-serif (not mono), th without uppercase.
// ---------------------------------------------------------------------------

const Th = markdownComponents.th as React.ComponentType<React.ThHTMLAttributes<HTMLTableCellElement>>;
const Td = markdownComponents.td as React.ComponentType<React.TdHTMLAttributes<HTMLTableCellElement>>;
const Tr = markdownComponents.tr as React.ComponentType<React.HTMLAttributes<HTMLTableRowElement>>;
const Thead = markdownComponents.thead as React.ComponentType<React.HTMLAttributes<HTMLTableSectionElement>>;
const Table = markdownComponents.table as React.ComponentType<React.TableHTMLAttributes<HTMLTableElement>>;

describe('markdownComponents table cells', () => {
  it('MarkdownTh does NOT use font-mono class', () => {
    const { container } = render(
      <table>
        <thead>
          <tr>
            <Th>Header</Th>
          </tr>
        </thead>
      </table>,
    );
    const th = container.querySelector('th');
    expect(th).not.toBeNull();
    expect(th!.className).not.toContain('font-mono');
  });

  it('MarkdownTh does NOT use uppercase class', () => {
    const { container } = render(
      <table>
        <thead>
          <tr>
            <Th>Header</Th>
          </tr>
        </thead>
      </table>,
    );
    const th = container.querySelector('th');
    expect(th!.className).not.toContain('uppercase');
  });

  it('MarkdownTh uses font-sans class', () => {
    const { container } = render(
      <table>
        <thead>
          <tr>
            <Th>Header</Th>
          </tr>
        </thead>
      </table>,
    );
    const th = container.querySelector('th');
    expect(th!.className).toContain('font-sans');
  });

  it('MarkdownTd does NOT use font-mono class', () => {
    const { container } = render(
      <table>
        <tbody>
          <tr>
            <Td>Cell</Td>
          </tr>
        </tbody>
      </table>,
    );
    const td = container.querySelector('td');
    expect(td).not.toBeNull();
    expect(td!.className).not.toContain('font-mono');
  });

  it('MarkdownTd uses font-sans class', () => {
    const { container } = render(
      <table>
        <tbody>
          <tr>
            <Td>Cell</Td>
          </tr>
        </tbody>
      </table>,
    );
    const td = container.querySelector('td');
    expect(td!.className).toContain('font-sans');
  });
});

describe('markdownComponents table structure', () => {
  it('MarkdownTable wrapper uses rounded-md (not rounded-lg)', () => {
    const { container } = render(
      <Table>
        <tbody>
          <tr>
            <td>x</td>
          </tr>
        </tbody>
      </Table>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('rounded-md');
    expect(wrapper.className).not.toContain('rounded-lg');
  });

  it('MarkdownTr even rows use bg-mf-content2 (not bg-accent)', () => {
    const { container } = render(
      <table>
        <tbody>
          <Tr>x</Tr>
        </tbody>
      </table>,
    );
    const tr = container.querySelector('tr');
    expect(tr!.className).toContain('even:bg-mf-content2');
    expect(tr!.className).not.toContain('even:bg-accent');
  });

  it('MarkdownThead uses bg-mf-content2', () => {
    const { container } = render(
      <table>
        <Thead>
          <tr>
            <th>h</th>
          </tr>
        </Thead>
      </table>,
    );
    const thead = container.querySelector('thead');
    expect(thead!.className).toContain('bg-mf-content2');
  });
});

// ---------------------------------------------------------------------------
// Markdown blockquote — must use 3px primary/40 border (not grey 2px).
// ---------------------------------------------------------------------------

describe('markdownComponents blockquote', () => {
  const Bq = markdownComponents.blockquote as React.ComponentType<React.BlockquoteHTMLAttributes<HTMLElement>>;

  it('uses border-s-[3px] (not border-s-2)', () => {
    const { container } = render(<Bq>quoted text</Bq>);
    const bq = container.querySelector('blockquote');
    expect(bq!.className).toContain('border-s-[3px]');
    expect(bq!.className).not.toContain('border-s-2');
  });

  it('uses border-primary/40 (not border-mf-text-3)', () => {
    const { container } = render(<Bq>quoted text</Bq>);
    const bq = container.querySelector('blockquote');
    expect(bq!.className).toContain('border-primary/40');
    expect(bq!.className).not.toContain('border-mf-text-3');
  });
});

// ---------------------------------------------------------------------------
// Markdown headings — h1 larger than h2, h2 larger than h3.
// ---------------------------------------------------------------------------

describe('markdownComponents headings hierarchy', () => {
  const H1 = markdownComponents.h1 as React.ComponentType<React.HTMLAttributes<HTMLHeadingElement>>;
  const H2 = markdownComponents.h2 as React.ComponentType<React.HTMLAttributes<HTMLHeadingElement>>;
  const H3 = markdownComponents.h3 as React.ComponentType<React.HTMLAttributes<HTMLHeadingElement>>;

  it('h1 uses text-title class (larger than body)', () => {
    const { container } = render(<H1>Heading 1</H1>);
    const h1 = container.querySelector('h1');
    expect(h1!.className).toContain('text-title');
  });

  it('h2 uses text-heading class', () => {
    const { container } = render(<H2>Heading 2</H2>);
    const h2 = container.querySelector('h2');
    expect(h2!.className).toContain('text-heading');
  });

  it('h2 does NOT use text-body (avoids collapsed hierarchy)', () => {
    const { container } = render(<H2>Heading 2</H2>);
    const h2 = container.querySelector('h2');
    expect(h2!.className).not.toContain('text-body');
  });

  it('h3 uses font-bold (heavier than body semibold)', () => {
    const { container } = render(<H3>Heading 3</H3>);
    const h3 = container.querySelector('h3');
    expect(h3!.className).toContain('font-bold');
  });
});

// ---------------------------------------------------------------------------
// Markdown HR — my-0.5 (minimal gap) not my-3.
// ---------------------------------------------------------------------------

describe('markdownComponents hr', () => {
  const Hr = markdownComponents.hr as React.ComponentType<React.HTMLAttributes<HTMLHRElement>>;

  it('uses my-0.5 margin (not my-3)', () => {
    const { container } = render(<Hr />);
    const hr = container.querySelector('hr');
    expect(hr!.className).toContain('my-0.5');
    expect(hr!.className).not.toContain('my-3');
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
});

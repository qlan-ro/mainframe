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
 * Mock strategy: `@/lib/tauri/bridge` is mocked at module level (vi.mock is
 * hoisted by vitest) to prevent the Tauri API from being invoked in jsdom.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';

// ---------------------------------------------------------------------------
// Mocks — must be declared before the import under test (vitest hoists vi.mock).
// ---------------------------------------------------------------------------

vi.mock('@/lib/tauri/bridge', () => ({
  openExternal: vi.fn().mockResolvedValue(undefined),
}));

// Import after mock declaration so the component picks up the mock.
import { openExternal } from '@/lib/tauri/bridge';
import { markdownComponents } from '../markdown-text';

const mockOpenExternal = vi.mocked(openExternal);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrap(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
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

    expect(mockOpenExternal).toHaveBeenCalledTimes(1);
    expect(mockOpenExternal).toHaveBeenCalledWith('https://example.com');
    expect(clickEvent.defaultPrevented).toBe(true);
  });
});

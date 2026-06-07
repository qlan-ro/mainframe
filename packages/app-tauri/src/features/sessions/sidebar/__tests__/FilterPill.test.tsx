/**
 * FilterPill — behavior tests (TDD red phase).
 *
 * Behaviors covered:
 *  - Renders a <button> with `testId` as data-testid and `aria-pressed` matching
 *    the `active` prop (active=true → aria-pressed="true").
 *  - Renders the `label` text exactly.
 *  - When badgeCount > 0, a child with data-testid={badgeTestId} shows the count.
 *  - When badgeCount === 0, no element with data-testid={badgeTestId} is in the DOM.
 *  - When swatchColor is supplied, a swatch element carries class `bg-mf-tag-<color>`;
 *    when omitted, no swatch element is present.
 *  - Clicking the button calls onClick exactly once.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterPill } from '../FilterPill';

// ---------------------------------------------------------------------------
// 1. aria-pressed reflects the active prop
// ---------------------------------------------------------------------------

describe('FilterPill — aria-pressed reflects active prop', () => {
  it('sets aria-pressed="true" when active=true', () => {
    render(<FilterPill label="All" active={true} testId="sessions-all-pill" onClick={() => undefined} />);
    expect(screen.getByTestId('sessions-all-pill')).toHaveAttribute('aria-pressed', 'true');
  });

  it('sets aria-pressed="false" when active=false', () => {
    render(<FilterPill label="All" active={false} testId="sessions-all-pill" onClick={() => undefined} />);
    expect(screen.getByTestId('sessions-all-pill')).toHaveAttribute('aria-pressed', 'false');
  });
});

// ---------------------------------------------------------------------------
// 2. Label text is rendered exactly
// ---------------------------------------------------------------------------

describe('FilterPill — renders the label text', () => {
  it('renders "My Project" as the visible label', () => {
    render(<FilterPill label="My Project" active={false} testId="sessions-project-pill" onClick={() => undefined} />);
    expect(screen.getByText('My Project')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 3. Badge renders count when badgeCount > 0
// ---------------------------------------------------------------------------

describe('FilterPill — badge renders count when badgeCount > 0', () => {
  it('shows "3" in the badge element when badgeCount=3', () => {
    render(
      <FilterPill
        label="Inbox"
        active={false}
        testId="sessions-inbox-pill"
        onClick={() => undefined}
        badgeCount={3}
        badgeTestId="sessions-inbox-badge"
      />,
    );
    expect(screen.getByTestId('sessions-inbox-badge').textContent).toBe('3');
  });
});

// ---------------------------------------------------------------------------
// 4. Badge is absent when badgeCount === 0
// ---------------------------------------------------------------------------

describe('FilterPill — badge is absent when badgeCount is 0', () => {
  it('does not render badgeTestId element when badgeCount=0', () => {
    render(
      <FilterPill
        label="Inbox"
        active={false}
        testId="sessions-inbox-pill"
        onClick={() => undefined}
        badgeCount={0}
        badgeTestId="sessions-inbox-badge"
      />,
    );
    expect(screen.queryByTestId('sessions-inbox-badge')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Swatch appears with correct color class when swatchColor is supplied
// ---------------------------------------------------------------------------

describe('FilterPill — swatch renders with bg-mf-tag-<color> class', () => {
  it('renders a swatch with class "bg-mf-tag-red" when swatchColor="red"', () => {
    render(
      <FilterPill
        label="Red Tag"
        active={false}
        testId="sessions-red-pill"
        onClick={() => undefined}
        swatchColor="red"
      />,
    );
    const swatch = screen.getByTestId('sessions-red-pill-swatch');
    expect(swatch.className).toContain('bg-mf-tag-red');
  });
});

// ---------------------------------------------------------------------------
// 6. Swatch is absent when swatchColor is omitted
// ---------------------------------------------------------------------------

describe('FilterPill — no swatch when swatchColor is omitted', () => {
  it('does not render the swatch element when swatchColor is not provided', () => {
    render(<FilterPill label="All" active={false} testId="sessions-all-pill" onClick={() => undefined} />);
    expect(screen.queryByTestId('sessions-all-pill-swatch')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7. onClick fires exactly once on click
// ---------------------------------------------------------------------------

describe('FilterPill — onClick called exactly once on click', () => {
  it('calls onClick once when the button is clicked', async () => {
    const handleClick = vi.fn();
    render(<FilterPill label="All" active={false} testId="sessions-all-pill" onClick={handleClick} />);

    await userEvent.click(screen.getByTestId('sessions-all-pill'));

    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});

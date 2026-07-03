/**
 * Tests for marker-pill primitives: MarkerPill state rendering.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MarkerPill, MarkerWrap, MarkerBody, MarkerCapsLabel, MarkerPre } from '../marker-pill';

// ── Helpers ───────────────────────────────────────────────────────────────────

const noop = () => {};

// ── MarkerPill ────────────────────────────────────────────────────────────────

describe('MarkerPill', () => {
  it('renders children text', () => {
    render(
      <MarkerPill icon={<span />} testId="pill">
        hello pill
      </MarkerPill>,
    );
    expect(screen.getByTestId('pill')).toHaveTextContent('hello pill');
  });

  it('is disabled by default (not expandable)', () => {
    render(
      <MarkerPill icon={<span />} testId="pill">
        text
      </MarkerPill>,
    );
    expect(screen.getByTestId('pill')).toBeDisabled();
  });

  it('is enabled and clickable when expandable and state is done', () => {
    let clicked = false;
    render(
      <MarkerPill
        icon={<span />}
        expandable
        state="done"
        onClick={() => {
          clicked = true;
        }}
        testId="pill"
      >
        text
      </MarkerPill>,
    );
    const btn = screen.getByTestId('pill');
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(clicked).toBe(true);
  });

  it('is disabled when state is pending even if expandable', () => {
    render(
      <MarkerPill icon={<span />} expandable state="pending" testId="pill">
        text
      </MarkerPill>,
    );
    expect(screen.getByTestId('pill')).toBeDisabled();
  });

  it('is disabled when state is error even if expandable', () => {
    render(
      <MarkerPill icon={<span />} expandable state="error" testId="pill">
        text
      </MarkerPill>,
    );
    expect(screen.getByTestId('pill')).toBeDisabled();
  });

  it('renders a chevron-right when expandable+done and open=false', () => {
    const { container } = render(
      <MarkerPill icon={<span />} expandable state="done" open={false} onClick={noop} testId="pill">
        text
      </MarkerPill>,
    );
    // lucide-react adds class names like "lucide-chevron-right" to each SVG
    expect(container.querySelector('.lucide-chevron-right')).toBeInTheDocument();
    expect(container.querySelector('.lucide-chevron-down')).not.toBeInTheDocument();
  });

  it('renders a chevron-down when expandable+done and open=true', () => {
    const { container } = render(
      <MarkerPill icon={<span />} expandable state="done" open={true} onClick={noop} testId="pill">
        text
      </MarkerPill>,
    );
    expect(container.querySelector('.lucide-chevron-down')).toBeInTheDocument();
    expect(container.querySelector('.lucide-chevron-right')).not.toBeInTheDocument();
  });

  it('renders a pulse dot when state is pending', () => {
    const { container } = render(
      <MarkerPill icon={<span />} state="pending" testId="pill">
        text
      </MarkerPill>,
    );
    const dot = container.querySelector('.animate-pulse');
    expect(dot).toBeInTheDocument();
  });

  it('does NOT render a pulse dot when state is done', () => {
    const { container } = render(
      <MarkerPill icon={<span />} state="done" testId="pill">
        text
      </MarkerPill>,
    );
    expect(container.querySelector('.animate-pulse')).not.toBeInTheDocument();
  });

  it('shows a tooltip with the provided title when the pill is hovered', async () => {
    const user = userEvent.setup();
    render(
      <MarkerPill icon={<span />} title="my-title" testId="pill">
        text
      </MarkerPill>,
    );
    // The pill button is the Hint trigger; hovering it reveals the tooltip.
    await user.hover(screen.getByTestId('pill'));
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('my-title');
  });
});

// ── MarkerWrap ────────────────────────────────────────────────────────────────

describe('MarkerWrap', () => {
  it('renders its children', () => {
    render(
      <MarkerWrap>
        <span data-testid="child">child</span>
      </MarkerWrap>,
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });
});

// ── MarkerBody ────────────────────────────────────────────────────────────────

describe('MarkerBody', () => {
  it('renders its children', () => {
    render(
      <MarkerBody>
        <span data-testid="body-child">body text</span>
      </MarkerBody>,
    );
    expect(screen.getByTestId('body-child')).toBeInTheDocument();
  });

  it('carries a default data-testid so the disclosure can be asserted without a class selector', () => {
    render(<MarkerBody>body text</MarkerBody>);
    expect(screen.getByTestId('marker-body')).toBeInTheDocument();
  });

  it('accepts a testId override for per-card disambiguation', () => {
    render(<MarkerBody testId="chat-skill-loaded-body">body text</MarkerBody>);
    expect(screen.getByTestId('chat-skill-loaded-body')).toBeInTheDocument();
    expect(screen.queryByTestId('marker-body')).not.toBeInTheDocument();
  });
});

// ── MarkerCapsLabel ───────────────────────────────────────────────────────────

describe('MarkerCapsLabel', () => {
  it('renders label text', () => {
    render(<MarkerCapsLabel>ARGUMENTS</MarkerCapsLabel>);
    expect(screen.getByText('ARGUMENTS')).toBeInTheDocument();
  });
});

// ── MarkerPre ─────────────────────────────────────────────────────────────────

describe('MarkerPre', () => {
  it('renders preformatted content', () => {
    render(<MarkerPre>const x = 1;</MarkerPre>);
    expect(screen.getByText('const x = 1;')).toBeInTheDocument();
  });
});

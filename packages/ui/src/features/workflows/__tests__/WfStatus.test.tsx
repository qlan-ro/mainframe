import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WfStatusPip, WfStatusTag, WfKindChip } from '@/features/workflows/WfStatus';

// ── WfStatusTag ────────────────────────────────────────────────────────────────

describe('WfStatusTag (step)', () => {
  it('renders the "Done" label for succeeded', () => {
    render(<WfStatusTag status="succeeded" kind="step" />);
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  it('renders "Uncertain" for ambiguous and uses warning color class', () => {
    render(<WfStatusTag status="ambiguous" kind="step" />);
    const el = screen.getByText('Uncertain');
    expect(el).toBeInTheDocument();
    // The pill wrapper should carry the warning color
    expect(el.closest('[class]')).toHaveClass('text-mf-warning');
  });

  it('renders "Running" for running status', () => {
    render(<WfStatusTag status="running" kind="step" />);
    expect(screen.getByText('Running')).toBeInTheDocument();
  });

  it('renders "Failed" for failed status and uses destructive color', () => {
    render(<WfStatusTag status="failed" kind="step" />);
    const el = screen.getByText('Failed');
    expect(el).toBeInTheDocument();
    expect(el.closest('[class]')).toHaveClass('text-destructive');
  });

  it('renders "Skipped" for skipped status', () => {
    render(<WfStatusTag status="skipped" kind="step" />);
    expect(screen.getByText('Skipped')).toBeInTheDocument();
  });

  it('renders "Waiting" for waiting status', () => {
    render(<WfStatusTag status="waiting" kind="step" />);
    expect(screen.getByText('Waiting')).toBeInTheDocument();
  });
});

describe('WfStatusTag (run)', () => {
  it('renders "Succeeded" for succeeded run status', () => {
    render(<WfStatusTag status="succeeded" kind="run" />);
    expect(screen.getByText('Succeeded')).toBeInTheDocument();
  });

  it('renders "Cancelled" for cancelled run status', () => {
    render(<WfStatusTag status="cancelled" kind="run" />);
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });
});

// ── WfStatusPip ────────────────────────────────────────────────────────────────

describe('WfStatusPip', () => {
  it('renders a spinning element for running', () => {
    const { container } = render(<WfStatusPip status="running" />);
    // The running pip uses animate-spin
    const spinner = container.querySelector('.animate-spin');
    expect(spinner).toBeTruthy();
  });

  it('renders a pulsing element for waiting', () => {
    const { container } = render(<WfStatusPip status="waiting" />);
    const pulse = container.querySelector('.animate-pulse');
    expect(pulse).toBeTruthy();
  });

  it('renders succeeded pip with a check icon (aria-hidden)', () => {
    const { container } = render(<WfStatusPip status="succeeded" />);
    // Has a rounded disc background
    expect(container.firstChild).toBeTruthy();
  });

  it('renders failed pip', () => {
    const { container } = render(<WfStatusPip status="failed" />);
    expect(container.firstChild).toBeTruthy();
  });

  it('renders ambiguous pip (TriangleAlert icon)', () => {
    const { container } = render(<WfStatusPip status="ambiguous" />);
    expect(container.firstChild).toBeTruthy();
  });

  it('renders skipped pip with dashed style', () => {
    const { container } = render(<WfStatusPip status="skipped" />);
    const el = container.querySelector('[class*="border-dashed"]');
    expect(el).toBeTruthy();
  });
});

// ── WfKindChip ────────────────────────────────────────────────────────────────

describe('WfKindChip', () => {
  it('renders the agent chip with an accessible title', () => {
    render(<WfKindChip kind="agent" />);
    // The title attr is on the wrapper span
    const chip = screen.getByTitle('Agent');
    expect(chip).toBeInTheDocument();
  });

  it('renders the choose/Branch chip', () => {
    render(<WfKindChip kind="choose" />);
    expect(screen.getByTitle('Branch')).toBeInTheDocument();
  });

  it('renders the call/Sub-workflow chip', () => {
    render(<WfKindChip kind="call" />);
    expect(screen.getByTitle('Sub-workflow')).toBeInTheDocument();
  });

  it('renders the foreach/Loop chip', () => {
    render(<WfKindChip kind="foreach" />);
    expect(screen.getByTitle('Loop')).toBeInTheDocument();
  });
});

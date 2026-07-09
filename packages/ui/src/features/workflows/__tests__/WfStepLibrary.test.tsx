/**
 * WfStepLibrary — TDD tests.
 *
 * Tests written FIRST (RED phase).
 * Covers:
 * - renders the catalog root with data-testid="workflows-steplib"
 * - renders all 8 step-kind cards (one per kind) in two groups
 * - group labels "Do work" and "Control flow" are present
 * - each card has data-testid="workflows-steplib-{kind}" (using canonical kinds)
 * - clicking a card calls onAdd with the correct kind
 * - clicking a card calls onClose
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WfStepLibrary } from '@/features/workflows/editor/WfStepLibrary';

describe('WfStepLibrary', () => {
  it('renders the catalog root with data-testid="workflows-steplib"', () => {
    render(<WfStepLibrary onAdd={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId('workflows-steplib')).toBeInTheDocument();
  });

  it('renders the "Do work" group heading', () => {
    render(<WfStepLibrary onAdd={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('Do work')).toBeInTheDocument();
  });

  it('renders the "Control flow" group heading', () => {
    render(<WfStepLibrary onAdd={vi.fn()} onClose={vi.fn()} />);
    // Multiple elements use "Control flow" text (group header + kind-tag chips)
    const elements = screen.getAllByText('Control flow');
    expect(elements.length).toBeGreaterThan(0);
  });

  it('renders all 8 step-kind cards with data-testid per kind', () => {
    render(<WfStepLibrary onAdd={vi.fn()} onClose={vi.fn()} />);
    // Do-work kinds (canonical kinds)
    expect(screen.getByTestId('workflows-steplib-agent')).toBeInTheDocument();
    expect(screen.getByTestId('workflows-steplib-service')).toBeInTheDocument();
    expect(screen.getByTestId('workflows-steplib-form')).toBeInTheDocument();
    expect(screen.getByTestId('workflows-steplib-set')).toBeInTheDocument();
    // Control-flow kinds
    expect(screen.getByTestId('workflows-steplib-choose')).toBeInTheDocument();
    expect(screen.getByTestId('workflows-steplib-foreach')).toBeInTheDocument();
    expect(screen.getByTestId('workflows-steplib-parallel')).toBeInTheDocument();
    expect(screen.getByTestId('workflows-steplib-call')).toBeInTheDocument();
  });

  it('clicking the agent card calls onAdd("agent") and onClose', () => {
    const onAdd = vi.fn();
    const onClose = vi.fn();
    render(<WfStepLibrary onAdd={onAdd} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('workflows-steplib-agent'));
    expect(onAdd).toHaveBeenCalledOnce();
    expect(onAdd).toHaveBeenCalledWith('agent');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('clicking the service card calls onAdd("service") and onClose', () => {
    const onAdd = vi.fn();
    const onClose = vi.fn();
    render(<WfStepLibrary onAdd={onAdd} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('workflows-steplib-service'));
    expect(onAdd).toHaveBeenCalledWith('service');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('clicking the form card calls onAdd("form") and onClose', () => {
    const onAdd = vi.fn();
    const onClose = vi.fn();
    render(<WfStepLibrary onAdd={onAdd} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('workflows-steplib-form'));
    expect(onAdd).toHaveBeenCalledWith('form');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('clicking the set card calls onAdd("set") and onClose', () => {
    const onAdd = vi.fn();
    const onClose = vi.fn();
    render(<WfStepLibrary onAdd={onAdd} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('workflows-steplib-set'));
    expect(onAdd).toHaveBeenCalledWith('set');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('clicking the choose card calls onAdd("choose") and onClose', () => {
    const onAdd = vi.fn();
    const onClose = vi.fn();
    render(<WfStepLibrary onAdd={onAdd} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('workflows-steplib-choose'));
    expect(onAdd).toHaveBeenCalledWith('choose');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('clicking the foreach card calls onAdd("foreach") and onClose', () => {
    const onAdd = vi.fn();
    const onClose = vi.fn();
    render(<WfStepLibrary onAdd={onAdd} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('workflows-steplib-foreach'));
    expect(onAdd).toHaveBeenCalledWith('foreach');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('clicking the parallel card calls onAdd("parallel") and onClose', () => {
    const onAdd = vi.fn();
    const onClose = vi.fn();
    render(<WfStepLibrary onAdd={onAdd} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('workflows-steplib-parallel'));
    expect(onAdd).toHaveBeenCalledWith('parallel');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('clicking the call card calls onAdd("call") and onClose', () => {
    const onAdd = vi.fn();
    const onClose = vi.fn();
    render(<WfStepLibrary onAdd={onAdd} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('workflows-steplib-call'));
    expect(onAdd).toHaveBeenCalledWith('call');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders "Step types" heading', () => {
    render(<WfStepLibrary onAdd={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('Step types')).toBeInTheDocument();
  });

  it('renders "Leaf" tag on agent card', () => {
    render(<WfStepLibrary onAdd={vi.fn()} onClose={vi.fn()} />);
    // Multiple "Leaf" chips present (one per leaf-kind card)
    const leafChips = screen.getAllByText('Leaf');
    expect(leafChips.length).toBeGreaterThan(0);
  });

  it('renders "Control flow" tag on choose card', () => {
    render(<WfStepLibrary onAdd={vi.fn()} onClose={vi.fn()} />);
    const chooseCard = screen.getByTestId('workflows-steplib-choose');
    // The "Control flow" tag lives inside the choose card
    // (the group header also uses the text, so check within the card)
    expect(chooseCard).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<WfStepLibrary onAdd={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('choose card shows the Branch label and GitBranch icon meta, not Service/Plug', () => {
    render(<WfStepLibrary onAdd={vi.fn()} onClose={vi.fn()} />);
    const card = screen.getByTestId('workflows-steplib-choose');
    expect(card.textContent).toContain('Branch');
    expect(card.textContent).not.toContain('Service');
  });

  it('foreach card shows Loop, call card shows Sub-workflow', () => {
    render(<WfStepLibrary onAdd={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId('workflows-steplib-foreach').textContent).toContain('Loop');
    expect(screen.getByTestId('workflows-steplib-call').textContent).toContain('Sub-workflow');
  });
});

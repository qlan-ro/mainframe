/**
 * WfBuilderPane — TDD tests.
 *
 * Tests written FIRST. All should fail before the implementation exists.
 * Covers:
 * - renders identity fields (name, description, scope toggle)
 * - editing name calls onChange with updated model
 * - adding a trigger calls onChange with the new trigger in the model
 * - adding a step calls onChange with the new step in the model
 * - adding an output calls onChange with the new output in the model
 * - removing a trigger calls onChange with the trigger removed
 * - removing a step calls onChange with the step removed
 * - re-serialization: a wrapper that serializes onChange output asserts YAML output
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { WfBuilderPane } from '@/features/workflows/editor/WfBuilderPane';
import { serializeWorkflow } from '@/features/workflows/editor/yaml-serialize';
import type { WfDraft } from '@/features/workflows/editor/yaml-serialize';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeBlankDraft(): WfDraft {
  return {
    name: '',
    description: '',
    scope: 'project',
    triggers: [],
    inputs: [],
    steps: [],
    outputs: [],
  };
}

function makeDraftWithTriggerAndStep(): WfDraft {
  return {
    name: 'My workflow',
    description: 'Test workflow',
    scope: 'global',
    triggers: [{ kind: 'manual' }],
    inputs: [],
    steps: [
      {
        id: 'q1',
        kind: 'question',
        name: 'ask',
        title: 'Ask the user',
        fields: [{ key: 'answer', type: 'text' }],
      },
    ],
    outputs: [],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WfBuilderPane', () => {
  it('renders the builder root with data-testid', () => {
    const onChange = vi.fn();
    render(<WfBuilderPane model={makeBlankDraft()} onChange={onChange} />);
    expect(screen.getByTestId('workflows-builder')).toBeInTheDocument();
  });

  it('renders the name input with data-testid', () => {
    const onChange = vi.fn();
    render(<WfBuilderPane model={makeBlankDraft()} onChange={onChange} />);
    expect(screen.getByTestId('workflows-builder-name')).toBeInTheDocument();
  });

  it('editing the name input calls onChange with the updated name', () => {
    const onChange = vi.fn();
    render(<WfBuilderPane model={makeBlankDraft()} onChange={onChange} />);
    const nameInput = screen.getByTestId('workflows-builder-name');
    fireEvent.change(nameInput, { target: { value: 'New name' } });
    expect(onChange).toHaveBeenCalledOnce();
    const updatedModel = onChange.mock.calls[0]?.[0] as WfDraft;
    expect(updatedModel.name).toBe('New name');
  });

  it('editing the name re-serializes to YAML with the new name', () => {
    let currentModel = makeBlankDraft();
    const onChange = vi.fn((m: WfDraft) => {
      currentModel = m;
    });
    render(<WfBuilderPane model={currentModel} onChange={onChange} />);
    const nameInput = screen.getByTestId('workflows-builder-name');
    fireEvent.change(nameInput, { target: { value: 'Health check' } });
    expect(onChange).toHaveBeenCalledOnce();
    const yaml = serializeWorkflow(currentModel);
    expect(yaml).toContain('name: Health check');
  });

  it('shows existing triggers', () => {
    const onChange = vi.fn();
    render(<WfBuilderPane model={makeDraftWithTriggerAndStep()} onChange={onChange} />);
    // "manual" trigger should appear
    expect(screen.getByText(/manual/i)).toBeInTheDocument();
  });

  it('add-trigger button renders with data-testid', () => {
    const onChange = vi.fn();
    render(<WfBuilderPane model={makeBlankDraft()} onChange={onChange} />);
    expect(screen.getByTestId('workflows-builder-add-trigger')).toBeInTheDocument();
  });

  it('clicking add-trigger opens the dropdown and picking "manual" calls onChange', () => {
    const onChange = vi.fn();
    render(<WfBuilderPane model={makeBlankDraft()} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('workflows-builder-add-trigger'));
    // The dropdown should show trigger kind options
    const manualOption = screen.getByRole('button', { name: /manual/i });
    fireEvent.click(manualOption);
    expect(onChange).toHaveBeenCalledOnce();
    const updatedModel = onChange.mock.calls[0]?.[0] as WfDraft;
    expect(updatedModel.triggers).toHaveLength(1);
    expect(updatedModel.triggers[0]?.kind).toBe('manual');
  });

  it('clicking add-trigger and picking "schedule" calls onChange with schedule trigger', () => {
    const onChange = vi.fn();
    render(<WfBuilderPane model={makeBlankDraft()} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('workflows-builder-add-trigger'));
    const scheduleOption = screen.getByRole('button', { name: /schedule/i });
    fireEvent.click(scheduleOption);
    expect(onChange).toHaveBeenCalledOnce();
    const updatedModel = onChange.mock.calls[0]?.[0] as WfDraft;
    expect(updatedModel.triggers[0]?.kind).toBe('schedule');
  });

  it('removing a trigger calls onChange with trigger removed', () => {
    const onChange = vi.fn();
    render(<WfBuilderPane model={makeDraftWithTriggerAndStep()} onChange={onChange} />);
    // The remove button should be inside the trigger row
    const removeButtons = screen.getAllByRole('button', { name: /remove trigger/i });
    expect(removeButtons.length).toBeGreaterThan(0);
    fireEvent.click(removeButtons[0]!);
    expect(onChange).toHaveBeenCalledOnce();
    const updatedModel = onChange.mock.calls[0]?.[0] as WfDraft;
    expect(updatedModel.triggers).toHaveLength(0);
  });

  it('add-step button renders with data-testid', () => {
    const onChange = vi.fn();
    render(<WfBuilderPane model={makeBlankDraft()} onChange={onChange} />);
    expect(screen.getByTestId('workflows-builder-add-step')).toBeInTheDocument();
  });

  it('clicking add-step opens the step library and picking "agent" calls onChange', () => {
    const onChange = vi.fn();
    render(<WfBuilderPane model={makeBlankDraft()} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('workflows-builder-add-step'));
    // The library overlay renders with testid cards
    const agentCard = screen.getByTestId('workflows-steplib-agent');
    fireEvent.click(agentCard);
    expect(onChange).toHaveBeenCalledOnce();
    const updatedModel = onChange.mock.calls[0]?.[0] as WfDraft;
    expect(updatedModel.steps).toHaveLength(1);
    expect(updatedModel.steps[0]?.kind).toBe('agent');
  });

  it('clicking add-step and picking "question" from the library calls onChange with a question step', () => {
    const onChange = vi.fn();
    render(<WfBuilderPane model={makeBlankDraft()} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('workflows-builder-add-step'));
    const questionCard = screen.getByTestId('workflows-steplib-question');
    fireEvent.click(questionCard);
    expect(onChange).toHaveBeenCalledOnce();
    const updatedModel = onChange.mock.calls[0]?.[0] as WfDraft;
    expect(updatedModel.steps[0]?.kind).toBe('question');
  });

  it('shows existing steps as rows', () => {
    const onChange = vi.fn();
    render(<WfBuilderPane model={makeDraftWithTriggerAndStep()} onChange={onChange} />);
    // Title is now an inline editable input; use getByDisplayValue.
    expect(screen.getByDisplayValue('Ask the user')).toBeInTheDocument();
  });

  it('removing a step calls onChange with step removed', () => {
    const onChange = vi.fn();
    render(<WfBuilderPane model={makeDraftWithTriggerAndStep()} onChange={onChange} />);
    const removeButtons = screen.getAllByRole('button', { name: /remove step/i });
    expect(removeButtons.length).toBeGreaterThan(0);
    fireEvent.click(removeButtons[0]!);
    expect(onChange).toHaveBeenCalledOnce();
    const updatedModel = onChange.mock.calls[0]?.[0] as WfDraft;
    expect(updatedModel.steps).toHaveLength(0);
  });

  it('add-output button renders with data-testid', () => {
    const onChange = vi.fn();
    render(<WfBuilderPane model={makeBlankDraft()} onChange={onChange} />);
    expect(screen.getByTestId('workflows-builder-add-output')).toBeInTheDocument();
  });

  it('clicking add-output calls onChange with a new output', () => {
    const onChange = vi.fn();
    render(<WfBuilderPane model={makeBlankDraft()} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('workflows-builder-add-output'));
    expect(onChange).toHaveBeenCalledOnce();
    const updatedModel = onChange.mock.calls[0]?.[0] as WfDraft;
    expect(updatedModel.outputs).toHaveLength(1);
  });

  it('renders the scope toggle', () => {
    const onChange = vi.fn();
    render(<WfBuilderPane model={makeBlankDraft()} onChange={onChange} />);
    expect(screen.getByText(/global/i)).toBeInTheDocument();
    expect(screen.getByText(/this project/i)).toBeInTheDocument();
  });

  it('clicking the Global scope button calls onChange with scope: global', () => {
    const onChange = vi.fn();
    const draft = makeBlankDraft(); // default scope is 'project'
    render(<WfBuilderPane model={draft} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /global/i }));
    expect(onChange).toHaveBeenCalledOnce();
    const updatedModel = onChange.mock.calls[0]?.[0] as WfDraft;
    expect(updatedModel.scope).toBe('global');
  });

  it('renders section headers for Triggers, Inputs, Steps, Outputs', () => {
    const onChange = vi.fn();
    render(<WfBuilderPane model={makeBlankDraft()} onChange={onChange} />);
    const root = screen.getByTestId('workflows-builder');
    expect(within(root).getByText('Triggers')).toBeInTheDocument();
    expect(within(root).getByText('Steps')).toBeInTheDocument();
    expect(within(root).getByText('Outputs')).toBeInTheDocument();
  });
});

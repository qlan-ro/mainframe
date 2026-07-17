/**
 * Recipe — the recursive step list with running scope accumulation (ts153
 * wf2-editor.jsx `WfRecipe`). TDD: test written first, implemented after.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ActionCatalogEntry, AutomationStep } from '../../contract';
import type { TokenDescriptor } from '../../domain/tokens';
import { validate } from '../../domain/validate';
import { Recipe } from '../Recipe';

const TODAY: TokenDescriptor = {
  ref: { stepId: 'builtin', output: 'today' },
  label: 'Today',
  type: 'date',
  sourceKind: 'builtin',
  source: 'Built-in',
};

const NO_CATALOG: ActionCatalogEntry[] = [];

function askAgent(id: string, extra: Partial<AutomationStep> = {}): AutomationStep {
  return { id, kind: 'ask_agent', prompt: [], ...extra } as AutomationStep;
}

describe('Recipe — running scope accumulation', () => {
  it('the first step only sees the tokens passed in (no prior siblings)', async () => {
    const user = userEvent.setup();
    const steps = [askAgent('a'), askAgent('b')];
    render(<Recipe steps={steps} onChange={vi.fn()} tokens={[TODAY]} catalog={NO_CATALOG} issues={[]} testId="root" />);

    await user.click(screen.getByTestId('automations-step-setup-a'));
    await user.click(screen.getByTestId('automations-step-config-a-prompt-picker'));

    expect(screen.getByTestId('automations-step-config-a-prompt-picker-option-builtin-today')).toBeInTheDocument();
    expect(screen.queryByTestId('automations-step-config-a-prompt-picker-option-a-result')).not.toBeInTheDocument();
  });

  it('a later step sees tokens produced by earlier siblings, an earlier step does not', async () => {
    const user = userEvent.setup();
    const steps = [askAgent('a'), askAgent('b')];
    render(<Recipe steps={steps} onChange={vi.fn()} tokens={[TODAY]} catalog={NO_CATALOG} issues={[]} testId="root" />);

    await user.click(screen.getByTestId('automations-step-setup-b'));
    await user.click(screen.getByTestId('automations-step-config-b-prompt-picker'));
    expect(screen.getByTestId('automations-step-config-b-prompt-picker-option-a-result')).toBeInTheDocument();

    await user.click(screen.getByTestId('automations-step-setup-a'));
    await user.click(screen.getByTestId('automations-step-config-a-prompt-picker'));
    expect(screen.queryByTestId('automations-step-config-a-prompt-picker-option-b-result')).not.toBeInTheDocument();
  });

  it('an If block leaks its branch outputs to later siblings, visible after the block', () => {
    const ifStep: AutomationStep = {
      id: 'if1',
      kind: 'if',
      match: 'all',
      conditions: [],
      then: [
        {
          id: 'inner',
          kind: 'notify',
          message: [{ token: { stepId: 'a', output: 'result' } }],
        },
      ],
      otherwise: [],
    };
    const after: AutomationStep = {
      id: 'after',
      kind: 'ask_agent',
      prompt: [{ token: { stepId: 'a', output: 'result' } }],
    };
    const steps = [askAgent('a'), ifStep, after];
    render(<Recipe steps={steps} onChange={vi.fn()} tokens={[TODAY]} catalog={NO_CATALOG} issues={[]} testId="root" />);
    // "after"'s prompt references "a"'s result, which was produced before the
    // If block — it must resolve to a real chip, not the "Missing value"
    // fallback, proving "after" received the accumulated scope.
    const afterCard = screen.getByTestId('automations-step-after');
    expect(afterCard).not.toHaveTextContent('Missing value');
  });
});

describe('Recipe — reordering', () => {
  it('moving a step calls onChange with the reordered array', () => {
    const steps = [askAgent('a'), askAgent('b'), askAgent('c')];
    const onChange = vi.fn();
    render(
      <Recipe steps={steps} onChange={onChange} tokens={[TODAY]} catalog={NO_CATALOG} issues={[]} testId="root" />,
    );

    const dataTransfer = { dropEffect: '' } as unknown as DataTransfer;
    const grip = screen.getByTestId('automations-step-grip-c');
    fireEvent.dragStart(grip, { dataTransfer });
    const target = screen.getByTestId('automations-step-a');
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });

    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1];
    const reordered = lastCall?.[0] as AutomationStep[];
    expect(reordered.map((s) => s.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('Recipe — deleting a step', () => {
  it('removing a step calls onChange without it', async () => {
    const user = userEvent.setup();
    const steps = [askAgent('a'), askAgent('b')];
    const onChange = vi.fn();
    render(
      <Recipe steps={steps} onChange={onChange} tokens={[TODAY]} catalog={NO_CATALOG} issues={[]} testId="root" />,
    );
    await user.click(screen.getByTestId('automations-step-delete-a'));
    expect(onChange).toHaveBeenCalledWith([steps[1]]);
  });
});

describe('Recipe — adding a step', () => {
  it('picking a verb from Add step appends a new step of that kind', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Recipe steps={[]} onChange={onChange} tokens={[TODAY]} catalog={NO_CATALOG} issues={[]} testId="root" />);
    await user.click(screen.getByTestId('root-add'));
    await user.click(screen.getByTestId('root-add-verb-notify'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const added = onChange.mock.calls[0]?.[0] as AutomationStep[];
    expect(added).toHaveLength(1);
    const first = added[0];
    expect(first).toMatchObject({ kind: 'notify', message: [] });
    expect(typeof first?.id).toBe('string');
    expect(first?.id.length).toBeGreaterThan(0);
  });

  it('a fresh "if" step has no conditions and empty then/otherwise', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Recipe steps={[]} onChange={onChange} tokens={[TODAY]} catalog={NO_CATALOG} issues={[]} testId="root" />);
    await user.click(screen.getByTestId('root-add'));
    await user.click(screen.getByTestId('root-add-verb-if'));
    const added = onChange.mock.calls[0]?.[0] as AutomationStep[];
    expect(added[0]).toMatchObject({ kind: 'if', match: 'all', conditions: [], then: [], otherwise: [] });
  });

  it('a fresh "repeat" step defaults items to a token already in scope', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Recipe steps={[]} onChange={onChange} tokens={[TODAY]} catalog={NO_CATALOG} issues={[]} testId="root" />);
    await user.click(screen.getByTestId('root-add'));
    await user.click(screen.getByTestId('root-add-verb-repeat'));
    const added = onChange.mock.calls[0]?.[0] as AutomationStep[];
    expect(added[0]).toMatchObject({ kind: 'repeat', steps: [] });
    expect((added[0] as { items?: unknown })?.items).toEqual(TODAY.ref);
  });

  it('a fresh "repeat" step whose only in-scope token is non-list-typed gets flagged by validate, not silently accepted', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    // Only TODAY (type "date") is in scope — no list token exists yet, so
    // Recipe's newStep fallback (first token in scope) picks a non-list
    // token. That must surface as a plain-language issue on the card, not
    // pass validation silently.
    render(<Recipe steps={[]} onChange={onChange} tokens={[TODAY]} catalog={NO_CATALOG} issues={[]} testId="root" />);
    await user.click(screen.getByTestId('root-add'));
    await user.click(screen.getByTestId('root-add-verb-repeat'));
    const added = onChange.mock.calls[0]?.[0] as AutomationStep[];
    const issues = validate('Automation', { triggers: [], steps: added }, NO_CATALOG);
    expect(issues).toContainEqual({
      stepId: added[0]?.id,
      level: 'error',
      msg: '"Today" isn\'t a list — pick a value that produces a list to repeat over.',
    });
  });
});

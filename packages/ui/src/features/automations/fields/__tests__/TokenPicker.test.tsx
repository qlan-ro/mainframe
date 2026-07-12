/**
 * TokenPicker — grouped-by-source token menu (ts153 `WfTokenPicker`). Object
 * tokens expand to pick a field (⟨PR › URL⟩). Out-of-scope tokens never
 * appear — the caller only ever passes the current `scopeAt(...)` result.
 * TDD: test written first, component implemented after.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TokenDescriptor } from '../../domain/tokens';
import { TokenPicker } from '../TokenPicker';

const TODAY: TokenDescriptor = {
  ref: { stepId: 'builtin', output: 'today' },
  label: 'Today',
  type: 'date',
  sourceKind: 'builtin',
  source: 'Built-in',
};

const AGENT_RESULT: TokenDescriptor = {
  ref: { stepId: 'pick-feature', output: 'result' },
  label: 'Result',
  type: 'text',
  sourceKind: 'agent',
  source: 'Ask agent',
};

const PR_TOKEN: TokenDescriptor = {
  ref: { stepId: 'open-pr', output: 'prUrl' },
  label: 'PR',
  type: 'object',
  sourceKind: 'action',
  source: 'Create a pull request',
  fields: ['url', 'number'],
};

describe('TokenPicker', () => {
  it('disables the trigger when the scope is empty', () => {
    render(<TokenPicker tokens={[]} onInsert={vi.fn()} testId="picker" />);
    expect(screen.getByTestId('picker')).toBeDisabled();
  });

  it('enables the trigger when tokens are available', () => {
    render(<TokenPicker tokens={[TODAY]} onInsert={vi.fn()} testId="picker" />);
    expect(screen.getByTestId('picker')).toBeEnabled();
  });

  it('groups tokens under their source header and lists only in-scope tokens', async () => {
    const user = userEvent.setup();
    render(<TokenPicker tokens={[TODAY, AGENT_RESULT]} onInsert={vi.fn()} testId="picker" />);

    await user.click(screen.getByTestId('picker'));

    expect(await screen.findByText('Built-in')).toBeInTheDocument();
    expect(screen.getByText('Ask agent')).toBeInTheDocument();
    expect(screen.getByTestId('picker-option-builtin-today')).toBeInTheDocument();
    expect(screen.getByTestId('picker-option-pick-feature-result')).toBeInTheDocument();
    // Nothing for a token that was never passed in (out of scope).
    expect(screen.queryByTestId('picker-option-open-pr-prUrl')).not.toBeInTheDocument();
  });

  it('clicking a leaf token inserts its ref and closes the menu', async () => {
    const user = userEvent.setup();
    const onInsert = vi.fn();
    render(<TokenPicker tokens={[TODAY]} onInsert={onInsert} testId="picker" />);

    await user.click(screen.getByTestId('picker'));
    await user.click(await screen.findByTestId('picker-option-builtin-today'));

    expect(onInsert).toHaveBeenCalledWith({ stepId: 'builtin', output: 'today' });
    expect(screen.queryByTestId('picker-menu')).not.toBeInTheDocument();
  });

  it('an object token expands to its fields instead of inserting immediately', async () => {
    const user = userEvent.setup();
    const onInsert = vi.fn();
    render(<TokenPicker tokens={[PR_TOKEN]} onInsert={onInsert} testId="picker" />);

    await user.click(screen.getByTestId('picker'));
    await user.click(await screen.findByTestId('picker-option-open-pr-prUrl'));

    expect(onInsert).not.toHaveBeenCalled();
    expect(screen.getByTestId('picker-option-open-pr-prUrl-url')).toBeInTheDocument();
    expect(screen.getByTestId('picker-option-open-pr-prUrl-number')).toBeInTheDocument();
  });

  it('clicking a field row inserts a ref carrying that field', async () => {
    const user = userEvent.setup();
    const onInsert = vi.fn();
    render(<TokenPicker tokens={[PR_TOKEN]} onInsert={onInsert} testId="picker" />);

    await user.click(screen.getByTestId('picker'));
    await user.click(await screen.findByTestId('picker-option-open-pr-prUrl'));
    await user.click(screen.getByTestId('picker-option-open-pr-prUrl-url'));

    expect(onInsert).toHaveBeenCalledWith({ stepId: 'open-pr', output: 'prUrl', field: 'url' });
  });
});

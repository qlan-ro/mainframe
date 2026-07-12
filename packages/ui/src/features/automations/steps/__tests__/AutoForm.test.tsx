/**
 * AutoForm — catalog metadata -> controls (ts153 wf2-stepconfig.jsx
 * `WfActionForm`, ported onto the UI-local `ActionParamsSchema` and the
 * contract's `Record<string, ChipText>` params). TDD: test written first,
 * implemented after.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChipText } from '../../contract';
import type { ActionParamsSchema } from '../action-fields';
import { AutoForm } from '../AutoForm';

describe('AutoForm', () => {
  it('renders a text field bound to params[key] and commits typed input', async () => {
    const user = userEvent.setup();
    const schema: ActionParamsSchema = { fields: [{ key: 'repo', label: 'Repository', control: 'text' }] };
    const onChange = vi.fn();
    render(
      <AutoForm
        schema={schema}
        params={{ repo: ['org/repo'] }}
        onChange={onChange}
        tokens={[]}
        testId="automations-autoform-a"
      />,
    );
    const input = screen.getByTestId('automations-autoform-a-repo');
    expect(input).toHaveValue('org/repo');
    await user.type(input, '!');
    expect(onChange).toHaveBeenLastCalledWith({ repo: ['org/repo!'] });
  });

  it('renders a select field via a native select and commits the chosen option as a single-part ChipText', async () => {
    const user = userEvent.setup();
    const schema: ActionParamsSchema = {
      fields: [{ key: 'runIn', label: 'Run in', control: 'select', options: ['project root', 'worktree', 'custom'] }],
    };
    const onChange = vi.fn();
    render(
      <AutoForm
        schema={schema}
        params={{ runIn: ['project root'] }}
        onChange={onChange}
        tokens={[]}
        testId="automations-autoform-a"
      />,
    );
    await user.selectOptions(screen.getByTestId('automations-autoform-a-runIn'), 'worktree');
    expect(onChange).toHaveBeenCalledWith({ runIn: ['worktree'] });
  });

  it('renders a chip field via ChipField, inserting a token part on pick', async () => {
    const user = userEvent.setup();
    const schema: ActionParamsSchema = { fields: [{ key: 'title', label: 'Title', control: 'chip' }] };
    const onChange = vi.fn();
    const tokens = [
      {
        ref: { stepId: 'ask-1', output: 'title' },
        label: 'Title',
        type: 'text' as const,
        sourceKind: 'askme' as const,
        source: 'Ask me',
      },
    ];
    render(
      <AutoForm
        schema={schema}
        params={{ title: [] }}
        onChange={onChange}
        tokens={tokens}
        testId="automations-autoform-a"
      />,
    );
    await user.click(screen.getByTestId('automations-autoform-a-title-picker'));
    await user.click(screen.getByTestId('automations-autoform-a-title-picker-option-ask-1-title'));
    expect(onChange).toHaveBeenCalledWith({ title: [{ token: { stepId: 'ask-1', output: 'title' } }] });
  });

  it('hides a field whose showWhen does not match the sibling value, and shows it once it does', async () => {
    const user = userEvent.setup();
    const schema: ActionParamsSchema = {
      fields: [
        { key: 'runIn', label: 'Run in', control: 'select', options: ['project root', 'custom'] },
        { key: 'cwdPath', label: 'Path', control: 'chip', showWhen: { key: 'runIn', equals: 'custom' } },
      ],
    };
    const { rerender } = render(
      <AutoForm
        schema={schema}
        params={{ runIn: ['project root'] }}
        onChange={vi.fn()}
        tokens={[]}
        testId="automations-autoform-a"
      />,
    );
    expect(screen.queryByTestId('automations-autoform-a-cwdPath')).not.toBeInTheDocument();

    rerender(
      <AutoForm
        schema={schema}
        params={{ runIn: ['custom'] }}
        onChange={vi.fn()}
        tokens={[]}
        testId="automations-autoform-a"
      />,
    );
    expect(screen.getByTestId('automations-autoform-a-cwdPath')).toBeInTheDocument();
    // sanity: the visible field actually accepts input.
    await user.click(screen.getByTestId('automations-autoform-a-cwdPath'));
  });

  it('renders a columns field as one row per column for the selected source value, writing each into params[columnName]', async () => {
    const user = userEvent.setup();
    const schema: ActionParamsSchema = {
      fields: [
        { key: 'databaseId', label: 'Database', control: 'select', options: ['Health Log', 'Reading list'] },
        {
          key: '__columns',
          label: 'Row',
          control: 'columns',
          columnsSourceKey: 'databaseId',
          columnsByOption: { 'Health Log': ['Date', 'Mood'], 'Reading list': ['Title', 'Author'] },
        },
      ],
    };
    const onChange = vi.fn();
    const params: Record<string, ChipText> = { databaseId: ['Health Log'] };
    render(
      <AutoForm schema={schema} params={params} onChange={onChange} tokens={[]} testId="automations-autoform-a" />,
    );
    expect(screen.getByTestId('automations-autoform-a-column-Date')).toBeInTheDocument();
    expect(screen.getByTestId('automations-autoform-a-column-Mood')).toBeInTheDocument();
    expect(screen.queryByTestId('automations-autoform-a-column-Title')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('automations-autoform-a-column-Date'));
    await user.keyboard('2026-07-12');
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith({ databaseId: ['Health Log'], Date: ['2026-07-12'] });
  });

  it('never writes the virtual __columns key itself to params', async () => {
    const schema: ActionParamsSchema = {
      fields: [
        { key: 'databaseId', label: 'Database', control: 'select', options: ['Health Log'] },
        {
          key: '__columns',
          label: 'Row',
          control: 'columns',
          columnsSourceKey: 'databaseId',
          columnsByOption: { 'Health Log': ['Date'] },
        },
      ],
    };
    render(
      <AutoForm
        schema={schema}
        params={{ databaseId: ['Health Log'] }}
        onChange={vi.fn()}
        tokens={[]}
        testId="automations-autoform-a"
      />,
    );
    expect(screen.queryByTestId('automations-autoform-a-__columns')).not.toBeInTheDocument();
  });
});

/**
 * TokenChip — read-only render of a resolved token (ts153 wf2-fields.jsx
 * `WfTokenChip`, ported onto `TokenDescriptor` since the contract's
 * `ChipPart` carries only `{token: TokenRef}` — no color/icon/label. TDD:
 * test written first, component implemented after.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import type { TokenDescriptor, TokenSourceKind } from '../../domain/tokens';
import { TokenChip, sourceKindStyle } from '../TokenChip';

const AGENT_TOKEN: TokenDescriptor = {
  ref: { stepId: 'pick-feature', output: 'result' },
  label: 'Result',
  type: 'text',
  sourceKind: 'agent',
  source: 'Ask agent',
};

const OBJECT_TOKEN: TokenDescriptor = {
  ref: { stepId: 'open-pr', output: 'prUrl' },
  label: 'PR',
  type: 'object',
  sourceKind: 'action',
  source: 'Create a pull request',
  fields: ['url', 'title'],
};

describe('TokenChip', () => {
  it('renders the resolved token label', () => {
    render(<TokenChip descriptor={AGENT_TOKEN} testId="chip-1" />);
    expect(screen.getByTestId('chip-1')).toHaveTextContent('Result');
  });

  it('appends the drilled-in field after a "›" separator', () => {
    render(<TokenChip descriptor={OBJECT_TOKEN} field="url" testId="chip-2" />);
    expect(screen.getByTestId('chip-2')).toHaveTextContent('PR');
    expect(screen.getByTestId('chip-2')).toHaveTextContent('›');
    expect(screen.getByTestId('chip-2')).toHaveTextContent('url');
  });

  it('renders no remove button when onRemove is not passed', () => {
    render(<TokenChip descriptor={AGENT_TOKEN} testId="chip-3" />);
    expect(screen.queryByTestId('chip-3-remove')).not.toBeInTheDocument();
  });

  it('clicking the remove button calls onRemove', () => {
    const onRemove = vi.fn();
    render(<TokenChip descriptor={AGENT_TOKEN} onRemove={onRemove} testId="chip-4" />);
    fireEvent.click(screen.getByTestId('chip-4-remove'));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('falls back to a "Missing value" chip when the descriptor cannot be resolved', () => {
    render(<TokenChip descriptor={null} testId="chip-5" />);
    expect(screen.getByTestId('chip-5')).toHaveTextContent('Missing value');
  });

  it('a missing chip can still be removed', () => {
    const onRemove = vi.fn();
    render(<TokenChip descriptor={null} onRemove={onRemove} testId="chip-6" />);
    fireEvent.click(screen.getByTestId('chip-6-remove'));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

describe('sourceKindStyle', () => {
  it('maps every TokenSourceKind to a distinct icon component', () => {
    const kinds: TokenSourceKind[] = ['builtin', 'trigger', 'agent', 'askme', 'action', 'item'];
    const icons = kinds.map((k) => sourceKindStyle(k).icon);
    expect(new Set(icons).size).toBe(kinds.length);
  });
});

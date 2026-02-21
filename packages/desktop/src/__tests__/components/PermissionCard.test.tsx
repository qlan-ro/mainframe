import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PermissionRequest } from '@mainframe/types';
import { PermissionCard } from '../../renderer/components/chat/PermissionCard.js';

function createRequest(overrides?: Partial<PermissionRequest>): PermissionRequest {
  return {
    requestId: 'req-1',
    toolName: 'Bash',
    toolUseId: 'tool-1',
    suggestions: [],
    input: { command: 'ls -la' },
    ...overrides,
  };
}

describe('PermissionCard', () => {
  it('renders the "Permission Required" header', () => {
    render(<PermissionCard request={createRequest()} onRespond={vi.fn()} />);
    expect(screen.getByText('Permission Required')).toBeInTheDocument();
  });

  it('renders the tool name', () => {
    render(<PermissionCard request={createRequest({ toolName: 'WriteFile' })} onRespond={vi.fn()} />);
    expect(screen.getByText('WriteFile')).toBeInTheDocument();
  });

  it('calls onRespond("allow") when Allow Once is clicked', async () => {
    const onRespond = vi.fn();
    render(<PermissionCard request={createRequest()} onRespond={onRespond} />);
    await userEvent.click(screen.getByRole('button', { name: /allow once/i }));
    expect(onRespond).toHaveBeenCalledWith('allow');
  });

  it('calls onRespond("deny") when Deny is clicked', async () => {
    const onRespond = vi.fn();
    render(<PermissionCard request={createRequest()} onRespond={onRespond} />);
    await userEvent.click(screen.getByRole('button', { name: /deny/i }));
    expect(onRespond).toHaveBeenCalledWith('deny');
  });

  it('does not show Always Allow button when no suggestions', () => {
    render(<PermissionCard request={createRequest({ suggestions: [] })} onRespond={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /always allow/i })).not.toBeInTheDocument();
  });

  it('shows Always Allow button when suggestions are present', () => {
    const suggestions = [{ ruleName: 'bash', ruleValue: 'ls' }];
    render(<PermissionCard request={createRequest({ suggestions })} onRespond={vi.fn()} />);
    expect(screen.getByRole('button', { name: /always allow/i })).toBeInTheDocument();
  });

  it('calls onRespond("allow", suggestions) when Always Allow is clicked', async () => {
    const suggestions = [{ ruleName: 'bash', ruleValue: 'ls' }];
    const onRespond = vi.fn();
    render(<PermissionCard request={createRequest({ suggestions })} onRespond={onRespond} />);
    await userEvent.click(screen.getByRole('button', { name: /always allow/i }));
    expect(onRespond).toHaveBeenCalledWith('allow', suggestions);
  });

  it('expands details section on click', async () => {
    render(<PermissionCard request={createRequest()} onRespond={vi.fn()} />);
    const detailsBtn = screen.getByRole('button', { name: /details/i });
    // Details pre is not visible before expanding
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    await userEvent.click(detailsBtn);
    // After clicking, the pre with JSON should appear
    expect(screen.getByText(/ls -la/)).toBeInTheDocument();
  });
});

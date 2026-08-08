/**
 * Tests for MCPToolCard — marker pill for mcp__<server>__<tool> tool calls.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MCPToolCard } from '../MCPToolCard';
import type { ToolCallMessagePartProps, ToolCallMessagePartStatus } from '@assistant-ui/react';

// ── Helpers ───────────────────────────────────────────────────────────────────

const noop = () => {};
const doneStatus: ToolCallMessagePartStatus = { type: 'complete' };
const runningStatus: ToolCallMessagePartStatus = { type: 'running' };

function renderCard(overrides: Partial<ToolCallMessagePartProps> & { toolName: string }) {
  const base = {
    type: 'tool-call' as const,
    toolCallId: 'test-id',
    toolName: 'mcp__placeholder__tool',
    args: {},
    argsText: '',
    result: undefined,
    isError: false,
    status: doneStatus,
    addResult: noop,
    resume: noop,
    respondToApproval: noop,
  };
  const defaults: ToolCallMessagePartProps = Object.assign({}, base, overrides);
  return render(
    <TooltipProvider>
      <MCPToolCard {...defaults} />
    </TooltipProvider>,
  );
}

// ── Done state ────────────────────────────────────────────────────────────────

describe('MCPToolCard — done state', () => {
  it('renders server name and "executed" verb when result is present', () => {
    renderCard({
      toolName: 'mcp__github__search_repos',
      args: { query: 'react' },
      result: 'found 10 results',
    });
    const pill = screen.getByTestId('chat-mcp-pill');
    expect(pill).toHaveTextContent('Github');
    expect(pill).toHaveTextContent('executed');
    expect(pill).toHaveTextContent('search_repos');
  });

  it('strips the claude_ai_ prefix from the server name and capitalizes', () => {
    renderCard({
      toolName: 'mcp__claude_ai_filesystem__read_file',
      args: {},
      result: 'file content',
    });
    const pill = screen.getByTestId('chat-mcp-pill');
    // strips 'claude_ai_' → 'filesystem' → 'Filesystem'
    expect(pill).toHaveTextContent('Filesystem');
    expect(pill).not.toHaveTextContent('claude_ai_');
  });

  it('pill is enabled (not disabled) in done state', () => {
    renderCard({
      toolName: 'mcp__github__list_issues',
      args: {},
      result: '[]',
    });
    expect(screen.getByTestId('chat-mcp-pill')).not.toBeDisabled();
  });

  it('clicking the pill expands and shows ARGUMENTS section', () => {
    renderCard({
      toolName: 'mcp__github__search_repos',
      args: { query: 'react' },
      result: 'found 10 results',
    });
    expect(screen.queryByText('Arguments')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('chat-mcp-pill'));
    expect(screen.getByText('Arguments')).toBeInTheDocument();
  });

  it('expanded body shows the result text', () => {
    renderCard({
      toolName: 'mcp__github__search_repos',
      args: { query: 'react' },
      result: 'found 10 results',
    });
    fireEvent.click(screen.getByTestId('chat-mcp-pill'));
    expect(screen.getByText('Result')).toBeInTheDocument();
    expect(screen.getByText('found 10 results')).toBeInTheDocument();
  });

  it('clicking the pill a second time collapses the body', () => {
    renderCard({
      toolName: 'mcp__github__search_repos',
      args: {},
      result: 'done',
    });
    const pill = screen.getByTestId('chat-mcp-pill');
    fireEvent.click(pill);
    expect(screen.getByText('Arguments')).toBeInTheDocument();
    fireEvent.click(pill);
    expect(screen.queryByText('Arguments')).not.toBeInTheDocument();
  });
});

// ── Pending state ─────────────────────────────────────────────────────────────

describe('MCPToolCard — pending state (result===undefined)', () => {
  it('renders "executing" verb when result is undefined', () => {
    renderCard({
      toolName: 'mcp__github__search_repos',
      args: {},
      result: undefined,
      status: runningStatus,
    });
    const pill = screen.getByTestId('chat-mcp-pill');
    expect(pill).toHaveTextContent('executing');
  });

  it('pill is disabled in pending state', () => {
    renderCard({
      toolName: 'mcp__github__search_repos',
      args: {},
      result: undefined,
      status: runningStatus,
    });
    expect(screen.getByTestId('chat-mcp-pill')).toBeDisabled();
  });

  it('does NOT show expanded body in pending state', () => {
    renderCard({
      toolName: 'mcp__github__search_repos',
      args: {},
      result: undefined,
      status: runningStatus,
    });
    expect(screen.queryByText('Arguments')).not.toBeInTheDocument();
  });
});

// ── Error state ───────────────────────────────────────────────────────────────

describe('MCPToolCard — error state', () => {
  it('renders "failed:" verb when isError is true', () => {
    renderCard({
      toolName: 'mcp__github__search_repos',
      args: {},
      result: 'something broke',
      isError: true,
    });
    const pill = screen.getByTestId('chat-mcp-pill');
    expect(pill).toHaveTextContent('failed:');
  });

  it('tool name is shown in error state', () => {
    renderCard({
      toolName: 'mcp__github__search_repos',
      args: {},
      result: 'something broke',
      isError: true,
    });
    expect(screen.getByTestId('chat-mcp-pill')).toHaveTextContent('search_repos');
  });

  it('pill is disabled in error state', () => {
    renderCard({
      toolName: 'mcp__github__search_repos',
      args: {},
      result: 'something broke',
      isError: true,
    });
    expect(screen.getByTestId('chat-mcp-pill')).toBeDisabled();
  });

  it('also detects error from result.isError=true on result object', () => {
    renderCard({
      toolName: 'mcp__github__search_repos',
      args: {},
      result: { isError: true, content: 'permission denied' },
      isError: false,
    });
    const pill = screen.getByTestId('chat-mcp-pill');
    expect(pill).toHaveTextContent('failed:');
  });
});

// ── MCP tool name parsing edge cases ─────────────────────────────────────────

describe('MCPToolCard — tool name parsing', () => {
  it('falls back to server=mcp (lowercase) when toolName does not match mcp__ pattern', () => {
    renderCard({
      toolName: 'some_random_tool',
      args: {},
      result: 'ok',
    });
    const pill = screen.getByTestId('chat-mcp-pill');
    // parseMcpToolName fallback returns { server: 'mcp', tool: toolName } — no capitalization on fallback path
    expect(pill).toHaveTextContent('mcp');
    expect(pill).toHaveTextContent('executed');
  });
});

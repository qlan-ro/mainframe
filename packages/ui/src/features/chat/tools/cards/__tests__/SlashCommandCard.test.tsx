/**
 * Tests for SlashCommandCard — inline row for the 'Skill' tool.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SlashCommandCard } from '../SlashCommandCard';
import type { ToolCallMessagePartProps, ToolCallMessagePartStatus } from '@assistant-ui/react';

// ── Helpers ───────────────────────────────────────────────────────────────────

const noop = () => {};
const doneStatus: ToolCallMessagePartStatus = { type: 'complete' };

function renderCard(args: Record<string, unknown>) {
  return render(
    <TooltipProvider>
      <SlashCommandCard
        type="tool-call"
        toolName="Skill"
        toolCallId="skill-1"
        args={args as ToolCallMessagePartProps['args']}
        argsText=""
        result="ok"
        isError={false}
        status={doneStatus}
        messages={[]}
        addResult={noop}
        resume={noop}
        respondToApproval={noop}
      />
    </TooltipProvider>,
  );
}

// ── Rendering ─────────────────────────────────────────────────────────────────

describe('SlashCommandCard', () => {
  it('renders the skill name prefixed with "/"', () => {
    renderCard({ skill: 'systematic-debugging' });
    expect(screen.getByText('/systematic-debugging')).toBeInTheDocument();
  });

  it('does NOT render args span when args is empty string', () => {
    renderCard({ skill: 'brainstorming', args: '' });
    expect(screen.queryByTestId('chat-slash-command-args')).not.toBeInTheDocument();
  });

  it('does NOT render args span when args key is absent', () => {
    renderCard({ skill: 'brainstorming' });
    expect(screen.queryByTestId('chat-slash-command-args')).not.toBeInTheDocument();
  });

  it('renders args span when args is a non-empty string', () => {
    renderCard({ skill: 'writing-plans', args: 'build the feature' });
    const argsEl = screen.getByTestId('chat-slash-command-args');
    expect(argsEl).toBeInTheDocument();
    expect(argsEl).toHaveTextContent('build the feature');
  });

  it('renders "/" when skill arg is missing', () => {
    renderCard({});
    expect(screen.getByText('/')).toBeInTheDocument();
  });

  it('renders "/" when skill arg is not a string', () => {
    renderCard({ skill: 42 });
    expect(screen.getByText('/')).toBeInTheDocument();
  });
});

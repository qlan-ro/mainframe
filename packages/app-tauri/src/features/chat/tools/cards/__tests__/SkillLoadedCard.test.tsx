/**
 * Tests for SkillLoadedCard — expandable pill for the '_SkillLoaded' tool.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SkillLoadedCard } from '../SkillLoadedCard';
import type { ToolCallMessagePartProps, ToolCallMessagePartStatus } from '@assistant-ui/react';

// ── Helpers ───────────────────────────────────────────────────────────────────

const noop = () => {};
const doneStatus: ToolCallMessagePartStatus = { type: 'complete' };

function renderCard(args: Record<string, unknown>) {
  return render(
    <TooltipProvider>
      <SkillLoadedCard
        type="tool-call"
        toolName="_SkillLoaded"
        toolCallId="skill-loaded-1"
        args={args as ToolCallMessagePartProps['args']}
        argsText=""
        result={undefined}
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

// ── Rendering — pill label ────────────────────────────────────────────────────

describe('SkillLoadedCard — pill label', () => {
  it('renders "Using skill:" followed by the skillName', () => {
    renderCard({ skillName: 'systematic-debugging', path: '/skills/sd.md', content: '# Skill content' });
    const pill = screen.getByTestId('chat-skill-loaded-pill');
    expect(pill).toHaveTextContent('Using skill:');
    expect(pill).toHaveTextContent('systematic-debugging');
  });

  it('renders pill with data-testid="chat-skill-loaded-pill"', () => {
    renderCard({ skillName: 'brainstorming', path: '', content: '' });
    expect(screen.getByTestId('chat-skill-loaded-pill')).toBeInTheDocument();
  });

  it('renders empty skill name gracefully when skillName is absent', () => {
    renderCard({ path: '/skills/foo.md', content: 'body' });
    const pill = screen.getByTestId('chat-skill-loaded-pill');
    expect(pill).toHaveTextContent('Using skill:');
  });
});

// ── Expandable behavior ───────────────────────────────────────────────────────

describe('SkillLoadedCard — expandable behavior', () => {
  it('starts collapsed — content not visible', () => {
    renderCard({ skillName: 'test-skill', path: '/p', content: 'secret content' });
    expect(screen.queryByText('secret content')).not.toBeInTheDocument();
  });

  it('clicking the pill reveals the content', () => {
    renderCard({ skillName: 'test-skill', path: '/p', content: 'skill body text here' });
    fireEvent.click(screen.getByTestId('chat-skill-loaded-pill'));
    expect(screen.getByText('skill body text here')).toBeInTheDocument();
  });

  it('clicking the pill a second time collapses the content', () => {
    renderCard({ skillName: 'test-skill', path: '/p', content: 'skill body text here' });
    const pill = screen.getByTestId('chat-skill-loaded-pill');
    fireEvent.click(pill);
    expect(screen.getByText('skill body text here')).toBeInTheDocument();
    fireEvent.click(pill);
    expect(screen.queryByText('skill body text here')).not.toBeInTheDocument();
  });

  it('is not expandable (disabled) when content is empty', () => {
    renderCard({ skillName: 'empty-skill', path: '/p', content: '' });
    expect(screen.getByTestId('chat-skill-loaded-pill')).toBeDisabled();
  });

  it('is not expandable (disabled) when content is absent', () => {
    renderCard({ skillName: 'empty-skill', path: '/p' });
    expect(screen.getByTestId('chat-skill-loaded-pill')).toBeDisabled();
  });

  it('is enabled when content is non-empty', () => {
    renderCard({ skillName: 'has-content', path: '/p', content: 'some content' });
    expect(screen.getByTestId('chat-skill-loaded-pill')).not.toBeDisabled();
  });
});

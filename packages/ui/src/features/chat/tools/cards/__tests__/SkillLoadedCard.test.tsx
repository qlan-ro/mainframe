/**
 * Tests for SkillLoadedCard — expandable pill rendered by SystemMessage from
 * skill_loaded metadata. Takes skillName/path/content as direct props (plain
 * component, NOT a ToolCallMessagePartComponent).
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SkillLoadedCard } from '../SkillLoadedCard';
import { nestedVerticalScrollers } from './_part-fixture';

// ── Wrapper ───────────────────────────────────────────────────────────────────

function Wrap({ children }: { children: React.ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>;
}

// ── Rendering — pill label ────────────────────────────────────────────────────

describe('SkillLoadedCard — pill label', () => {
  it('renders "Using skill:" followed by the skillName', () => {
    render(
      <Wrap>
        <SkillLoadedCard skillName="systematic-debugging" path="/skills/sd.md" content="# Skill content" />
      </Wrap>,
    );
    const pill = screen.getByTestId('chat-skill-loaded-pill');
    expect(pill).toHaveTextContent('Using skill:');
    expect(pill).toHaveTextContent('systematic-debugging');
  });

  it('renders pill with data-testid="chat-skill-loaded-pill"', () => {
    render(
      <Wrap>
        <SkillLoadedCard skillName="brainstorming" />
      </Wrap>,
    );
    expect(screen.getByTestId('chat-skill-loaded-pill')).toBeInTheDocument();
  });

  it('renders empty skill name gracefully when skillName is an empty string', () => {
    render(
      <Wrap>
        <SkillLoadedCard skillName="" path="/skills/foo.md" content="body" />
      </Wrap>,
    );
    const pill = screen.getByTestId('chat-skill-loaded-pill');
    expect(pill).toHaveTextContent('Using skill:');
  });
});

// ── Expandable behavior ───────────────────────────────────────────────────────

describe('SkillLoadedCard — expandable behavior', () => {
  it('starts collapsed — content not visible', () => {
    render(
      <Wrap>
        <SkillLoadedCard skillName="test-skill" path="/p" content="secret content" />
      </Wrap>,
    );
    expect(screen.queryByText('secret content')).not.toBeInTheDocument();
  });

  it('clicking the pill reveals the content', () => {
    render(
      <Wrap>
        <SkillLoadedCard skillName="test-skill" path="/p" content="skill body text here" />
      </Wrap>,
    );
    fireEvent.click(screen.getByTestId('chat-skill-loaded-pill'));
    expect(screen.getByText('skill body text here')).toBeInTheDocument();
  });

  it('does not nest a vertical scroll container in the expanded content (single overflow owner)', () => {
    const { container } = render(
      <Wrap>
        <SkillLoadedCard skillName="test-skill" path="/p" content={'line 1\nline 2\nline 3'} />
      </Wrap>,
    );
    fireEvent.click(screen.getByTestId('chat-skill-loaded-pill'));
    expect(nestedVerticalScrollers(container)).toHaveLength(0);
  });

  it('clicking the pill a second time collapses the content', () => {
    render(
      <Wrap>
        <SkillLoadedCard skillName="test-skill" path="/p" content="skill body text here" />
      </Wrap>,
    );
    const pill = screen.getByTestId('chat-skill-loaded-pill');
    fireEvent.click(pill);
    expect(screen.getByText('skill body text here')).toBeInTheDocument();
    fireEvent.click(pill);
    expect(screen.queryByText('skill body text here')).not.toBeInTheDocument();
  });

  it('is not expandable (disabled) when content is empty string', () => {
    render(
      <Wrap>
        <SkillLoadedCard skillName="empty-skill" path="/p" content="" />
      </Wrap>,
    );
    expect(screen.getByTestId('chat-skill-loaded-pill')).toBeDisabled();
  });

  it('is not expandable (disabled) when content prop is omitted', () => {
    render(
      <Wrap>
        <SkillLoadedCard skillName="empty-skill" path="/p" />
      </Wrap>,
    );
    expect(screen.getByTestId('chat-skill-loaded-pill')).toBeDisabled();
  });

  it('is enabled when content is non-empty', () => {
    render(
      <Wrap>
        <SkillLoadedCard skillName="has-content" path="/p" content="some content" />
      </Wrap>,
    );
    expect(screen.getByTestId('chat-skill-loaded-pill')).not.toBeDisabled();
  });
});

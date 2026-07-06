import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProjectChip } from '../project-chip';

describe('ProjectChip', () => {
  it('renders the project name and forwards data-testid', () => {
    render(<ProjectChip projectId="proj-a" name="Mainframe" data-testid="chat-header-project" />);
    const chip = screen.getByTestId('chat-header-project');
    expect(chip).toHaveTextContent('Mainframe');
  });

  it('applies a deterministic identity color via inline style', () => {
    render(<ProjectChip projectId="proj-a" name="A" data-testid="chip-a" />);
    const chip = screen.getByTestId('chip-a');
    // color is an oklch(...) string sourced from projectColor — non-empty inline color.
    expect(chip.getAttribute('style') ?? '').toContain('oklch');
  });
});

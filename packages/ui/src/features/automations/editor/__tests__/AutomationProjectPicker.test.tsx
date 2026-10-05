import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { Project } from '@qlan-ro/mainframe-types';
import { AutomationProjectPicker, resolveDefaultProjectId } from '../AutomationProjectPicker';

function project(id: string, name: string): Project {
  return { id, name } as Project;
}

function renderPicker(projects: Project[], value: string | null, onChange = vi.fn()) {
  render(
    <TooltipProvider>
      <AutomationProjectPicker projects={projects} value={value} onChange={onChange} />
    </TooltipProvider>,
  );
  return onChange;
}

describe('AutomationProjectPicker — visibility', () => {
  it('renders nothing with zero projects', () => {
    const { container } = render(
      <TooltipProvider>
        <AutomationProjectPicker projects={[]} value={null} onChange={vi.fn()} />
      </TooltipProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing (hidden entirely) with exactly one scoped project', () => {
    const { container } = render(
      <TooltipProvider>
        <AutomationProjectPicker projects={[project('p1', 'Solo')]} value="p1" onChange={vi.fn()} />
      </TooltipProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the row, including an "All projects" chip first, with 2+ projects', () => {
    renderPicker([project('p1', 'Alpha'), project('p2', 'Beta')], 'p1');
    expect(screen.getByTestId('automations-editor-project')).toBeInTheDocument();
    expect(screen.getByTestId('automations-editor-project-all')).toBeInTheDocument();
    expect(screen.getByTestId('automations-editor-project-p1')).toBeInTheDocument();
    expect(screen.getByTestId('automations-editor-project-p2')).toBeInTheDocument();
  });
});

describe('AutomationProjectPicker — selection', () => {
  it('marks the selected chip aria-checked and shows its name', () => {
    renderPicker([project('p1', 'Alpha'), project('p2', 'Beta')], 'p2');
    expect(screen.getByTestId('automations-editor-project-p2')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('automations-editor-project-p1')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('automations-editor-project-name')).toHaveTextContent('Beta');
  });

  it('shows "All projects" when value is null', () => {
    renderPicker([project('p1', 'Alpha'), project('p2', 'Beta')], null);
    expect(screen.getByTestId('automations-editor-project-all')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('automations-editor-project-name')).toHaveTextContent('All projects');
  });

  it('clicking a chip calls onChange with that project id', async () => {
    const user = userEvent.setup();
    const onChange = renderPicker([project('p1', 'Alpha'), project('p2', 'Beta')], 'p1');
    await user.click(screen.getByTestId('automations-editor-project-p2'));
    expect(onChange).toHaveBeenCalledWith('p2');
  });

  it('clicking the "All projects" chip calls onChange with null', async () => {
    const user = userEvent.setup();
    const onChange = renderPicker([project('p1', 'Alpha'), project('p2', 'Beta')], 'p1');
    await user.click(screen.getByTestId('automations-editor-project-all'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('ArrowRight/ArrowLeft move and select the neighboring chip, wrapping at the ends', async () => {
    const user = userEvent.setup();
    const onChange = renderPicker([project('p1', 'Alpha'), project('p2', 'Beta')], 'p1');
    screen.getByTestId('automations-editor-project-p1').focus();

    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('p2');

    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith(null);

    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('p2');
  });
});

describe('resolveDefaultProjectId', () => {
  it('returns the sole project when exactly one is scoped', () => {
    expect(resolveDefaultProjectId([project('p1', 'Solo')], null)).toBe('p1');
  });

  it('returns the active project when it is one of the scoped projects', () => {
    expect(resolveDefaultProjectId([project('p1', 'Alpha'), project('p2', 'Beta')], 'p2')).toBe('p2');
  });

  it('falls back to the first scoped project when the active project is not in scope', () => {
    expect(resolveDefaultProjectId([project('p1', 'Alpha'), project('p2', 'Beta')], 'elsewhere')).toBe('p1');
  });

  it('falls back to the first scoped project when there is no active project', () => {
    expect(resolveDefaultProjectId([project('p1', 'Alpha'), project('p2', 'Beta')], null)).toBe('p1');
  });

  it('returns null (global) when there are no scoped projects at all', () => {
    expect(resolveDefaultProjectId([], null)).toBeNull();
  });
});

/**
 * TaskProjectChips.test.tsx
 *
 * Behaviors covered:
 *  1. Renders nothing with fewer than two projects.
 *  2. The `value` project is pre-selected (aria-checked) and named below the row.
 *  3. Clicking another avatar selects it and calls onChange.
 *  4. ArrowRight/ArrowLeft move the selection (wrapping); Space/Enter select
 *     the focused avatar.
 *  5. Each avatar's tooltip is the project's name (Hint label).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Project } from '@qlan-ro/mainframe-types';
import { TaskProjectChips } from '../TaskProjectChips';

const PROJECTS: Project[] = [
  { id: 'proj-1', name: 'Mainframe', path: '/repos/mainframe' } as Project,
  { id: 'proj-2', name: 'Sidecar', path: '/repos/sidecar' } as Project,
  { id: 'proj-3', name: 'Zygote', path: '/repos/zygote' } as Project,
];

describe('TaskProjectChips — fewer than two projects', () => {
  it('renders nothing with a single project', () => {
    const { container } = render(<TaskProjectChips projects={[PROJECTS[0]!]} value="proj-1" onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing with zero projects', () => {
    const { container } = render(<TaskProjectChips projects={[]} value="" onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('TaskProjectChips — default selection', () => {
  it('marks the value project aria-checked and shows its name below the row', () => {
    render(<TaskProjectChips projects={PROJECTS} value="proj-2" onChange={vi.fn()} />);

    expect(screen.getByTestId('tasks-edit-project-proj-2')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('tasks-edit-project-proj-1')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('tasks-edit-project-proj-3')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Sidecar')).toBeInTheDocument();
  });
});

describe('TaskProjectChips — click selects', () => {
  it('calls onChange with the clicked project id', async () => {
    const onChange = vi.fn();
    render(<TaskProjectChips projects={PROJECTS} value="proj-1" onChange={onChange} />);

    await userEvent.click(screen.getByTestId('tasks-edit-project-proj-3'));
    expect(onChange).toHaveBeenCalledWith('proj-3');
  });
});

describe('TaskProjectChips — keyboard', () => {
  it('ArrowRight from the selected avatar selects the next one, wrapping at the end', async () => {
    const onChange = vi.fn();
    render(<TaskProjectChips projects={PROJECTS} value="proj-3" onChange={onChange} />);

    screen.getByTestId('tasks-edit-project-proj-3').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('proj-1');
  });

  it('ArrowLeft from the first avatar selects the last one, wrapping backward', async () => {
    const onChange = vi.fn();
    render(<TaskProjectChips projects={PROJECTS} value="proj-1" onChange={onChange} />);

    screen.getByTestId('tasks-edit-project-proj-1').focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenCalledWith('proj-3');
  });

  it('Space/Enter selects the focused avatar', async () => {
    const onChange = vi.fn();
    render(<TaskProjectChips projects={PROJECTS} value="proj-1" onChange={onChange} />);

    screen.getByTestId('tasks-edit-project-proj-2').focus();
    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('proj-2');
  });
});

describe('TaskProjectChips — tooltip', () => {
  it('each avatar carries the project name as its accessible tooltip content', async () => {
    render(<TaskProjectChips projects={PROJECTS} value="proj-1" onChange={vi.fn()} />);

    await userEvent.hover(screen.getByTestId('tasks-edit-project-proj-2'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Sidecar');
  });
});

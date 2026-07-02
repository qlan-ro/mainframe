import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DraftSessionRow } from '../DraftSessionRow';

function setup(overrides: Partial<Parameters<typeof DraftSessionRow>[0]> = {}) {
  const onSelect = vi.fn();
  const onDiscard = vi.fn();
  render(
    <DraftSessionRow
      projectId="proj-a"
      projectName="Mainframe"
      selected={false}
      showProject
      onSelect={onSelect}
      onDiscard={onDiscard}
      {...overrides}
    />,
  );
  return { onSelect, onDiscard };
}

describe('DraftSessionRow', () => {
  it('renders the New Session title and the ghost meta', () => {
    setup();
    expect(screen.getByTestId('sessions-draft-row-title')).toHaveTextContent('New Session');
    expect(screen.getByTestId('sessions-draft-row')).toHaveTextContent('draft — clears if you leave without sending');
  });

  it('shows the project chip only when showProject is true', () => {
    const { onSelect } = setup({ showProject: false });
    expect(screen.queryByText('Mainframe')).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('calls onSelect when the row body is clicked', () => {
    const { onSelect } = setup();
    fireEvent.click(screen.getByTestId('sessions-draft-row'));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('calls onDiscard (not onSelect) when the ✕ is clicked', () => {
    const { onSelect, onDiscard } = setup();
    fireEvent.click(screen.getByTestId('sessions-draft-row-discard'));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('marks the row active when selected', () => {
    setup({ selected: true });
    expect(screen.getByTestId('sessions-draft-row')).toHaveAttribute('data-active', 'true');
  });
});

/**
 * SlashMenu — slash-command suggestions for ChipField's leading-"/" trigger
 * (ts153 `WF2_SLASH` + the inline suggestion list in `WfChipField`). TDD:
 * test written first, component implemented after.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SlashMenu, SLASH_COMMANDS, matchSlashCommands } from '../SlashMenu';

describe('matchSlashCommands', () => {
  it('filters commands by prefix, case-insensitively', () => {
    expect(matchSlashCommands('/pl')).toEqual(['/plan']);
    expect(matchSlashCommands('/PL')).toEqual(['/plan']);
  });

  it('returns every command for a bare "/"', () => {
    expect(matchSlashCommands('/')).toEqual(SLASH_COMMANDS);
  });

  it('returns an empty array when nothing matches', () => {
    expect(matchSlashCommands('/zzz')).toEqual([]);
  });
});

describe('SlashMenu', () => {
  it('renders only the matching commands for a narrowing query', () => {
    render(<SlashMenu query="/pl" onSelect={vi.fn()} testId="slash-menu" />);
    expect(screen.getByTestId('slash-menu-option-/plan')).toBeInTheDocument();
    expect(screen.queryByTestId('slash-menu-option-/test')).not.toBeInTheDocument();
  });

  it('falls back to the full command list when the query matches nothing', () => {
    render(<SlashMenu query="/zzz" onSelect={vi.fn()} testId="slash-menu" />);
    for (const cmd of SLASH_COMMANDS) {
      expect(screen.getByTestId(`slash-menu-option-${cmd}`)).toBeInTheDocument();
    }
  });

  it('clicking a command calls onSelect with that command', () => {
    const onSelect = vi.fn();
    render(<SlashMenu query="/pl" onSelect={onSelect} testId="slash-menu" />);
    fireEvent.mouseDown(screen.getByTestId('slash-menu-option-/plan'));
    expect(onSelect).toHaveBeenCalledWith('/plan');
  });
});

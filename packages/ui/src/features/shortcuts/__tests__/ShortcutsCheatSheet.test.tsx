/**
 * The ⌘/ cheat sheet: open/close wiring (dispatcher → store → dialog) plus
 * the fixture-seam contract that lets a new registry entry appear with no
 * change to this component (AC 15/16/19).
 */
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShortcutDescriptor } from '../shortcut-types';

// jsdom reports a Linux-ish platform, so `mod` would resolve to Ctrl and the ⌘
// cases below would miss. The dispatcher reads this once at mount.
vi.mock('@/features/shortcuts/platform', () => ({ isMacPlatform: () => true }));

import { useShortcutDispatcher } from '../use-shortcut-dispatcher';
import { useShortcutAction } from '../action-store';
import { useCheatSheetStore, toggleCheatSheet } from '../cheat-sheet-store';
import { ShortcutsCheatSheet } from '../ShortcutsCheatSheet';

function mountCheatSheetAction() {
  return renderHook(() => {
    useShortcutDispatcher();
    useShortcutAction('app.cheat-sheet', toggleCheatSheet);
  });
}

const pressCheatSheet = () => fireEvent.keyDown(window, { code: 'Slash', metaKey: true });

/** Plain (non-React) nodes a test injects to simulate "another modal is open" —
 *  tracked and removed explicitly so they never leak into a later test, unlike
 *  `document.body.innerHTML = ''`, which fights Radix's own portal cleanup. */
const injectedNodes: HTMLElement[] = [];
function injectOtherModal(): void {
  const el = document.createElement('div');
  el.setAttribute('data-slot', 'dialog-content');
  document.body.appendChild(el);
  injectedNodes.push(el);
}

beforeEach(() => {
  useCheatSheetStore.setState({ open: false });
});

afterEach(() => {
  injectedNodes.splice(0).forEach((el) => el.remove());
});

describe('⌘/ open/close wiring', () => {
  it('opens the dialog', () => {
    render(<ShortcutsCheatSheet />);
    const { unmount } = mountCheatSheetAction();

    pressCheatSheet();

    expect(screen.getByTestId('shortcuts-cheat-sheet')).toBeInTheDocument();
    unmount();
  });

  it('a second ⌘/ closes it', async () => {
    render(<ShortcutsCheatSheet />);
    const { unmount } = mountCheatSheetAction();

    pressCheatSheet();
    expect(screen.getByTestId('shortcuts-cheat-sheet')).toBeInTheDocument();
    pressCheatSheet();

    await waitFor(() => expect(screen.queryByTestId('shortcuts-cheat-sheet')).not.toBeInTheDocument());
    unmount();
  });

  it('Escape closes it', async () => {
    useCheatSheetStore.setState({ open: true });
    render(<ShortcutsCheatSheet />);
    expect(screen.getByTestId('shortcuts-cheat-sheet')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });

    await waitFor(() => expect(useCheatSheetStore.getState().open).toBe(false));
  });

  it('does not open while another Dialog is already rendered (AC 14)', () => {
    injectOtherModal();
    render(<ShortcutsCheatSheet />);
    const { unmount } = mountCheatSheetAction();

    pressCheatSheet();

    expect(useCheatSheetStore.getState().open).toBe(false);
    expect(screen.queryByTestId('shortcuts-cheat-sheet')).not.toBeInTheDocument();
    unmount();
  });
});

describe('the fixture seam (AC 15/16/19)', () => {
  const FIXTURE_ENTRIES: ShortcutDescriptor[] = [
    {
      id: 'fixture.sessions-action',
      chord: { code: 'KeyZ', mod: true },
      label: 'Fixture sessions action',
      group: 'Sessions',
    },
    { id: 'fixture.chat-action', chord: { code: 'KeyY', mod: true }, label: 'Fixture chat action', group: 'Chat' },
    {
      id: 'fixture.workspace-action',
      chord: { code: 'KeyX', mod: true },
      label: 'Fixture workspace action',
      group: 'Workspace',
    },
    { id: 'fixture.app-action', chord: { code: 'KeyW', mod: true }, label: 'Fixture app action', group: 'App' },
    {
      id: 'fixture.dev-action',
      chord: { code: 'KeyV', mod: true },
      label: 'Fixture dev action',
      group: 'App',
      dev: true,
    },
  ];

  it('shows an entry the shipped app does not ship, with no per-shortcut props', () => {
    useCheatSheetStore.setState({ open: true });
    render(<ShortcutsCheatSheet entries={FIXTURE_ENTRIES} dev={false} />);

    expect(screen.getByTestId('shortcuts-cheat-sheet-row-fixture.sessions-action')).toHaveTextContent(
      'Fixture sessions action',
    );
  });

  it('hides a dev:true fixture entry when dev is false', () => {
    useCheatSheetStore.setState({ open: true });
    render(<ShortcutsCheatSheet entries={FIXTURE_ENTRIES} dev={false} />);

    expect(screen.queryByTestId('shortcuts-cheat-sheet-row-fixture.dev-action')).not.toBeInTheDocument();
  });

  it('shows a dev:true fixture entry when dev is true', () => {
    useCheatSheetStore.setState({ open: true });
    render(<ShortcutsCheatSheet entries={FIXTURE_ENTRIES} dev={true} />);

    expect(screen.getByTestId('shortcuts-cheat-sheet-row-fixture.dev-action')).toHaveTextContent('Fixture dev action');
  });

  it('keys every row by shortcut id, one testid per entry', () => {
    useCheatSheetStore.setState({ open: true });
    render(<ShortcutsCheatSheet entries={FIXTURE_ENTRIES} dev={true} />);

    for (const entry of FIXTURE_ENTRIES) {
      expect(screen.getByTestId(`shortcuts-cheat-sheet-row-${entry.id}`)).toBeInTheDocument();
    }
  });

  it('groups sections in Sessions / Chat / Workspace / App order', () => {
    useCheatSheetStore.setState({ open: true });
    render(<ShortcutsCheatSheet entries={FIXTURE_ENTRIES} dev={true} />);

    const groups = screen.getAllByTestId(/^shortcuts-cheat-sheet-group-/).map((el) => el.getAttribute('data-testid'));

    expect(groups).toEqual([
      'shortcuts-cheat-sheet-group-sessions',
      'shortcuts-cheat-sheet-group-chat',
      'shortcuts-cheat-sheet-group-workspace',
      'shortcuts-cheat-sheet-group-app',
    ]);
  });

  it('skips a group with no visible entry', () => {
    useCheatSheetStore.setState({ open: true });
    render(<ShortcutsCheatSheet entries={[FIXTURE_ENTRIES[0]!]} dev={false} />);

    expect(screen.queryByTestId('shortcuts-cheat-sheet-group-chat')).not.toBeInTheDocument();
    expect(screen.getByTestId('shortcuts-cheat-sheet-group-sessions')).toBeInTheDocument();
  });
});

/**
 * ActionCatalog — searchable, source-segmented action picker (ts153
 * wf2-stepconfig.jsx `WfActionCatalog`, ported onto contract action ids —
 * the prototype's single "Files" action is split into files.append/write/
 * read, contract §5). TDD: test written first, implemented after.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ACTION_CATALOG_FIXTURE } from '../../fixtures/action-catalog';
import { ActionCatalog } from '../ActionCatalog';

describe('ActionCatalog', () => {
  it('lists all nine actions by default, including the three split files.* entries', () => {
    render(<ActionCatalog catalog={ACTION_CATALOG_FIXTURE} onPick={vi.fn()} testId="automations-catalog" />);
    expect(screen.getByTestId('automations-catalog-action-files.append')).toBeInTheDocument();
    expect(screen.getByTestId('automations-catalog-action-files.write')).toBeInTheDocument();
    expect(screen.getByTestId('automations-catalog-action-files.read')).toBeInTheDocument();
    expect(screen.getAllByTestId(/^automations-catalog-action-/)).toHaveLength(9);
  });

  it('filters by search query across title and blurb', async () => {
    const user = userEvent.setup();
    render(<ActionCatalog catalog={ACTION_CATALOG_FIXTURE} onPick={vi.fn()} testId="automations-catalog" />);
    await user.type(screen.getByTestId('automations-catalog-search'), 'pull request');
    expect(screen.getByTestId('automations-catalog-action-github.create_pr')).toBeInTheDocument();
    expect(screen.queryByTestId('automations-catalog-action-run_command')).not.toBeInTheDocument();
  });

  it('shows a "no actions match" empty state when the search has no hits', async () => {
    const user = userEvent.setup();
    render(<ActionCatalog catalog={ACTION_CATALOG_FIXTURE} onPick={vi.fn()} testId="automations-catalog" />);
    await user.type(screen.getByTestId('automations-catalog-search'), 'zzz-nothing-matches');
    expect(screen.getByText(/no actions match/i)).toBeInTheDocument();
  });

  it('filters by source segment: builtin shows only builtin actions', async () => {
    const user = userEvent.setup();
    render(<ActionCatalog catalog={ACTION_CATALOG_FIXTURE} onPick={vi.fn()} testId="automations-catalog" />);
    await user.click(screen.getByTestId('automations-catalog-filter-builtin'));
    expect(screen.getByTestId('automations-catalog-action-run_command')).toBeInTheDocument();
    expect(screen.queryByTestId('automations-catalog-action-github.create_pr')).not.toBeInTheDocument();
  });

  it('filters by source segment: connector shows only connector actions', async () => {
    const user = userEvent.setup();
    render(<ActionCatalog catalog={ACTION_CATALOG_FIXTURE} onPick={vi.fn()} testId="automations-catalog" />);
    await user.click(screen.getByTestId('automations-catalog-filter-connector'));
    expect(screen.getByTestId('automations-catalog-action-github.create_pr')).toBeInTheDocument();
    expect(screen.queryByTestId('automations-catalog-action-run_command')).not.toBeInTheDocument();
  });

  it('the mcp segment is empty at launch (contract §9: no mcp:* entries until the flag is on)', async () => {
    const user = userEvent.setup();
    render(<ActionCatalog catalog={ACTION_CATALOG_FIXTURE} onPick={vi.fn()} testId="automations-catalog" />);
    await user.click(screen.getByTestId('automations-catalog-filter-mcp'));
    expect(screen.getByText(/no actions match/i)).toBeInTheDocument();
  });

  it('shows a LIST badge only for actions whose output type is list', () => {
    render(<ActionCatalog catalog={ACTION_CATALOG_FIXTURE} onPick={vi.fn()} testId="automations-catalog" />);
    const listPrsRow = screen.getByTestId('automations-catalog-action-github.list_prs');
    expect(listPrsRow).toHaveTextContent('LIST');
    const runCommandRow = screen.getByTestId('automations-catalog-action-run_command');
    expect(runCommandRow).not.toHaveTextContent('LIST');
  });

  it('clicking a row calls onPick with that catalog entry', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<ActionCatalog catalog={ACTION_CATALOG_FIXTURE} onPick={onPick} testId="automations-catalog" />);
    await user.click(screen.getByTestId('automations-catalog-action-run_command'));
    expect(onPick).toHaveBeenCalledWith(ACTION_CATALOG_FIXTURE.find((a) => a.id === 'run_command'));
  });

  describe('an action the daemon reported unavailable', () => {
    const REASON = "The GitHub CLI isn't signed in. Run `gh auth login`.";
    const muted = ACTION_CATALOG_FIXTURE.map((a) =>
      a.id === 'github.create_pr' ? { ...a, available: false, unavailableReason: REASON } : a,
    );

    it('shows the reason in place of the blurb and refuses the pick', async () => {
      const user = userEvent.setup();
      const onPick = vi.fn();
      render(<ActionCatalog catalog={muted} onPick={onPick} testId="automations-catalog" />);
      const row = screen.getByTestId('automations-catalog-action-github.create_pr');
      expect(row).toBeDisabled();
      expect(row).toHaveTextContent('UNAVAILABLE');
      expect(row).toHaveTextContent(REASON);
      expect(row).not.toHaveTextContent('Open a pull request on GitHub.');
      await user.click(row);
      expect(onPick).not.toHaveBeenCalled();
    });

    it('leaves every other action pickable', () => {
      render(<ActionCatalog catalog={muted} onPick={vi.fn()} testId="automations-catalog" />);
      expect(screen.getByTestId('automations-catalog-action-github.list_prs')).toBeEnabled();
    });
  });
});

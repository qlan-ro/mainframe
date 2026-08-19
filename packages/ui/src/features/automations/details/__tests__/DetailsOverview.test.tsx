/**
 * DetailsOverview against the `release-digest` fixture: `set_variable` ships
 * in a canonical fixture, so the read-only pane renders it whether or not the
 * editor can author one yet — a missing verb entry took the whole pane down.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AutomationDefinition } from '../../contract';
import { RELEASE_DIGEST_FIXTURE } from '../../fixtures/fixtures';
import { DetailsOverview } from '../DetailsOverview';

describe('DetailsOverview', () => {
  it('renders the fixture’s set_variable step with its verb label and summary', () => {
    render(<DetailsOverview definition={RELEASE_DIGEST_FIXTURE.definition} catalog={[]} />);

    const row = screen.getByTestId('automations-details-step-set-headline');
    expect(row).toHaveTextContent('Set value');
    expect(row).toHaveTextContent('Set $headline');
  });

  it('renders a parallel block as a branch-count caption, not a leaf summary', () => {
    const definition: AutomationDefinition = {
      triggers: [],
      steps: [
        {
          id: 'split',
          kind: 'parallel',
          branches: [
            [{ id: 'a', kind: 'notify', message: ['ping'] }],
            [{ id: 'b', kind: 'notify', message: ['pong'] }],
          ],
        },
      ],
    };
    render(<DetailsOverview definition={definition} catalog={[]} />);

    const row = screen.getByTestId('automations-details-step-split');
    expect(row).toHaveTextContent('Run in parallel');
    expect(row).toHaveTextContent('2 branches running at once');
  });
});

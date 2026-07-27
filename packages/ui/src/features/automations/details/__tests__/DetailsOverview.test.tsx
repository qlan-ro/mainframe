/**
 * DetailsOverview against the `release-digest` fixture: `set_variable` ships
 * in a canonical fixture, so the read-only pane renders it whether or not the
 * editor can author one yet — a missing verb entry took the whole pane down.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RELEASE_DIGEST_FIXTURE } from '../../fixtures/fixtures';
import { DetailsOverview } from '../DetailsOverview';

describe('DetailsOverview', () => {
  it('renders the fixture’s set_variable step with its verb label and summary', () => {
    render(<DetailsOverview definition={RELEASE_DIGEST_FIXTURE.definition} catalog={[]} />);

    const row = screen.getByTestId('automations-details-step-set-headline');
    expect(row).toHaveTextContent('Set value');
    expect(row).toHaveTextContent('Set $headline');
  });
});

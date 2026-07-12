import { it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AutomationsView } from '../AutomationsView';
import { useAutomationsNav } from '../data/use-automations-nav';
import { useAutomationsStore } from '../data/use-automations-store';

it('renders the header, the count, and closes via the close button', () => {
  useAutomationsStore.setState({ definitions: [], interactions: [] });
  useAutomationsNav.setState({ open: true, editorTarget: null, runId: null });
  render(<AutomationsView />);

  expect(screen.getByText('Workflows')).toBeInTheDocument();
  expect(screen.getByTestId('automations-title-count')).toHaveTextContent('0 automations');

  fireEvent.click(screen.getByTestId('automations-close'));
  expect(useAutomationsNav.getState().open).toBe(false);
});

it('shows the library section by default, listing loaded definitions', () => {
  useAutomationsNav.setState({ editorTarget: null, runId: null });
  useAutomationsStore.setState({
    definitions: [
      {
        id: 'a1',
        name: 'Daily standup',
        scope: 'global',
        projectId: null,
        enabled: true,
        definition: { triggers: [], steps: [] },
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  });
  render(<AutomationsView />);

  expect(screen.getByTestId('automations-section-library')).toBeInTheDocument();
  expect(screen.getByTestId('automations-library-row-a1')).toHaveTextContent('Daily standup');
});

it('shows the (lazy-loaded) editor section when an editor target is open', async () => {
  useAutomationsStore.setState({ definitions: [] });
  useAutomationsNav.setState({ editorTarget: { mode: 'new' }, runId: null });
  render(<AutomationsView />);
  // AutomationEditor is React.lazy — the Suspense boundary swaps its whole
  // subtree (including this wrapper div) for the fallback until the chunk
  // resolves, so this assertion must await it rather than getByTestId.
  expect(await screen.findByTestId('automations-section-editor')).toBeInTheDocument();
});

it('shows the run placeholder section when a run id is open, taking precedence over the editor', () => {
  useAutomationsStore.setState({ definitions: [] });
  useAutomationsNav.setState({ editorTarget: { mode: 'new' }, runId: 'r1' });
  render(<AutomationsView />);
  expect(screen.getByTestId('automations-section-run')).toBeInTheDocument();
});

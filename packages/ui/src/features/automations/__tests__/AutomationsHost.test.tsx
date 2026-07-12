import { it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AutomationsHost } from '../AutomationsHost';
import { useAutomationsNav } from '../data/use-automations-nav';
import { useAutomationsStore } from '../data/use-automations-store';

it('renders nothing while closed', () => {
  useAutomationsNav.setState({ open: false, editorTarget: null, runId: null });
  const { container } = render(<AutomationsHost />);
  expect(container).toBeEmptyDOMElement();
});

it('renders the view once opened, and loads automations from the gateway', async () => {
  useAutomationsStore.setState({ definitions: [] });
  useAutomationsNav.setState({ open: true, editorTarget: null, runId: null });
  render(<AutomationsHost />);

  expect(screen.getByTestId('automations-host')).toBeInTheDocument();
  expect(await screen.findByTestId('automations-view')).toBeInTheDocument();
  expect(useAutomationsStore.getState().definitions.length).toBe(6);
});

it('clicking the backdrop closes the host', () => {
  useAutomationsStore.setState({ definitions: [] });
  useAutomationsNav.setState({ open: true, editorTarget: null, runId: null });
  render(<AutomationsHost />);
  fireEvent.click(screen.getByTestId('automations-host'));
  expect(useAutomationsNav.getState().open).toBe(false);
});

/**
 * AutomationsRuntime — the always-mounted half of automations.
 *
 * Moved out of AutomationsHost.test.tsx (D23/phase 5): the pending-interaction
 * load that feeds the nav rail's badge no longer depends on the modal ever
 * opening — it lives in this component, mounted unconditionally in AppShell.
 */
import { it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { AutomationsRuntime } from '../AutomationsRuntime';
import { useAutomationsStore } from '../data/use-automations-store';
import { createFixtureGateway } from '../fixtures/fixture-gateway';

beforeEach(() => {
  // The store is module-global: a previous test's state would leak.
  useAutomationsStore.setState({ scopeProjectId: null, libraries: {}, gateway: createFixtureGateway() });
});

it('renders nothing', () => {
  const { container } = render(<AutomationsRuntime />);
  expect(container).toBeEmptyDOMElement();
});

it('loads interactions on mount, so the sidebar badge is populated on boot — with no modal ever opened', async () => {
  useAutomationsStore.setState({ interactions: [] });
  render(<AutomationsRuntime />);

  await vi.waitFor(() => {
    expect(useAutomationsStore.getState().interactions.length).toBeGreaterThan(0);
  });
});

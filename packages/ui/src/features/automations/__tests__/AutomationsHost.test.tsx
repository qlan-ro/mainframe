/**
 * AutomationsHost — unit tests.
 *
 * D5: the Dialog is gone — the library lives in the body (`AutomationsSurface`)
 * and the sidebar (`AutomationsSidebarList`) now. All that's left here is the
 * ⌘⇧A shortcut wiring, retargeted to show the rail view.
 */
import { it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { AutomationsHost } from '../AutomationsHost';
import { shortcutAction } from '@/features/shortcuts/action-store';
import { useUiPrefs } from '@/store/ui-prefs';

beforeEach(() => {
  useUiPrefs.setState({ sidebarView: 'chats' });
});

it('renders nothing', () => {
  const { container } = render(<AutomationsHost />);
  expect(container).toBeEmptyDOMElement();
});

it('registers app.automations to show the Automations rail view', () => {
  render(<AutomationsHost />);
  shortcutAction('app.automations')?.(0);
  expect(useUiPrefs.getState().sidebarView).toBe('automations');
});

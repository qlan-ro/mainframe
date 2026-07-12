/**
 * DescribeFlow — textarea + "Draft it" + hint state, stub behind
 * `DESCRIBE_ENABLED` (ts153 wf2-runtime.jsx `WfDescribeFlow`). No drafting
 * endpoint in the contract (§9 known deferral) — "Draft it" always resolves
 * to the same canned fixture, never the typed description; the artifact
 * itself (an editable block list, never a buried prompt) is what's under
 * test, not NL parsing. Self-sufficient like `AutomationEditor`: reads/
 * writes `use-automations-nav` and `use-automations-store` directly. TDD:
 * test written first, implemented after.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAutomationsNav } from '../../data/use-automations-nav';
import { useAutomationsStore } from '../../data/use-automations-store';
import { DescribeFlow } from '../DescribeFlow';

beforeEach(() => {
  useAutomationsNav.setState({ open: true, editorTarget: null, runId: null, describeOpen: true });
  useAutomationsStore.setState({ catalog: [] });
});

describe('DescribeFlow — before drafting', () => {
  it('renders the textarea and Draft it, with no preview yet', () => {
    render(<DescribeFlow />);
    expect(screen.getByTestId('automations-describe-input')).toBeInTheDocument();
    expect(screen.getByTestId('automations-describe-draft')).toBeInTheDocument();
    expect(screen.queryByTestId('automations-draft-preview')).not.toBeInTheDocument();
  });

  it('Back returns to the library', () => {
    render(<DescribeFlow />);
    screen.getByTestId('automations-describe-back').click();
    expect(useAutomationsNav.getState().describeOpen).toBe(false);
  });
});

describe('DescribeFlow — after drafting', () => {
  it('clicking Draft it shows a preview of the drafted automation', async () => {
    const user = userEvent.setup();
    render(<DescribeFlow />);
    await user.click(screen.getByTestId('automations-describe-draft'));
    expect(screen.getByTestId('automations-draft-preview')).toBeInTheDocument();
  });

  it('"Try a different description" clears the preview', async () => {
    const user = userEvent.setup();
    render(<DescribeFlow />);
    await user.click(screen.getByTestId('automations-describe-draft'));
    await user.click(screen.getByTestId('automations-describe-retry'));
    expect(screen.queryByTestId('automations-draft-preview')).not.toBeInTheDocument();
  });

  it('"Open in editor" opens the editor pre-filled with the draft', async () => {
    const user = userEvent.setup();
    render(<DescribeFlow />);
    await user.click(screen.getByTestId('automations-describe-draft'));
    await user.click(screen.getByTestId('automations-describe-open-editor'));

    const target = useAutomationsNav.getState().editorTarget;
    expect(target?.mode).toBe('new');
    expect(target?.mode === 'new' ? target.draft?.name : undefined).toBeTruthy();
    expect(useAutomationsNav.getState().describeOpen).toBe(false);
  });
});

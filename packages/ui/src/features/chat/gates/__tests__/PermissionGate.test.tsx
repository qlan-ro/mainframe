/**
 * PermissionGate — behavior tests.
 *
 * Strategy:
 *  - Component is fully prop-driven: no hooks, no context dependencies beyond
 *    TooltipProvider.
 *  - All expected values are hardcoded; the ControlResponse objects are the
 *    contract — they are never recomputed from the component under test.
 *  - Wrap renders in TooltipProvider for Radix compatibility.
 *
 * Behaviors covered:
 *  - Root data-testid and tool name visibility.
 *  - Details toggle: pre hidden by default, shown after click, contains
 *    pretty-printed input JSON.
 *  - Deny button: calls reply with hardcoded deny ControlResponse.
 *  - Allow-once button: calls reply with hardcoded allow ControlResponse.
 *  - Always-allow button absent when suggestions array is empty.
 *  - Always-allow button present and calls reply with updatedPermissions when
 *    suggestions are provided.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ChatPermissionEntry } from '../../controller/chat-thread-state';
import type { ControlUpdate } from '@qlan-ro/mainframe-types';
import { PermissionGate, type ReplyFn } from '../PermissionGate';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrap(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SUG: ControlUpdate = {
  type: 'addRules',
  rules: [{ toolName: 'Bash', ruleContent: 'git:*' }],
  behavior: 'allow',
  destination: 'session',
};

function makeEntry(suggestions: ControlUpdate[] = []): ChatPermissionEntry {
  return {
    requestId: 'r1',
    askedAt: 1,
    request: {
      requestId: 'r1',
      toolName: 'Bash',
      toolUseId: 'tu1',
      input: { command: 'ls -la' },
      suggestions,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PermissionGate', () => {
  let reply: Mock<ReplyFn>;

  beforeEach(() => {
    reply = vi.fn<ReplyFn>();
  });

  // --- Behavior 1: root renders and shows tool name ---

  it('renders the root chat-permission-gate and shows the tool name "Bash"', () => {
    wrap(<PermissionGate entry={makeEntry()} reply={reply} />);
    expect(screen.getByTestId('chat-permission-gate')).toBeInTheDocument();
    expect(screen.getByText('Bash')).toBeInTheDocument();
  });

  // --- Behavior 2: details toggle ---

  it('does not show details pre initially, shows it after toggle click with pretty-printed input', () => {
    wrap(<PermissionGate entry={makeEntry()} reply={reply} />);
    expect(screen.queryByTestId('chat-permission-details-pre')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('chat-permission-details-toggle'));

    const pre = screen.getByTestId('chat-permission-details-pre');
    expect(pre).toBeInTheDocument();
    expect(pre.textContent).toContain('"command": "ls -la"');
  });

  // --- Finding 6.8: JSON block uses the dark terminal palette, not a plain raised card ---

  it('the details JSON block uses the terminal bg/fg tokens', () => {
    wrap(<PermissionGate entry={makeEntry()} reply={reply} />);
    fireEvent.click(screen.getByTestId('chat-permission-details-toggle'));

    const pre = screen.getByTestId('chat-permission-details-pre');
    expect(pre).toHaveClass('bg-mf-term-bg', 'text-mf-term-fg');
  });

  // --- Finding 6.16: Details reveal mounts with an enter transition ---

  it('the details JSON block mounts with an enter transition', () => {
    wrap(<PermissionGate entry={makeEntry()} reply={reply} />);
    fireEvent.click(screen.getByTestId('chat-permission-details-toggle'));

    expect(screen.getByTestId('chat-permission-details-pre')).toHaveClass('animate-in', 'fade-in-0');
  });

  // --- Finding 6.2: ToolNameRow/DetailsDisclosure indent aligns to the head's own
  //     49px title inset (px-3.5 tile-inset + 26px tile + gap-2.5), not pl-12 (64px) ---

  it('the tool-name row aligns to the head title inset (pl-[49px], not pl-12)', () => {
    wrap(<PermissionGate entry={makeEntry()} reply={reply} />);
    const row = screen.getByText('Bash').closest('div');
    expect(row).toHaveClass('pl-[49px]');
    expect(row).not.toHaveClass('pl-12');
  });

  // --- Finding 6.13: disclosure chevron is 11px, not 6px (size-3) ---

  it('the details chevron is sized to the design spec (11px)', () => {
    wrap(<PermissionGate entry={makeEntry()} reply={reply} />);
    const toggle = screen.getByTestId('chat-permission-details-toggle');
    const chevron = toggle.querySelector('svg');
    expect(chevron).toHaveClass('size-[11px]');
  });

  // --- Behavior 3: deny button ---

  it('clicking deny calls reply once with the deny ControlResponse', () => {
    wrap(<PermissionGate entry={makeEntry()} reply={reply} />);
    fireEvent.click(screen.getByTestId('chat-permission-deny'));

    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith({
      requestId: 'r1',
      toolUseId: 'tu1',
      toolName: 'Bash',
      behavior: 'deny',
    });
  });

  // --- Behavior 4: allow-once button ---

  it('clicking allow-once calls reply once with the allow ControlResponse including updatedInput', () => {
    wrap(<PermissionGate entry={makeEntry()} reply={reply} />);
    fireEvent.click(screen.getByTestId('chat-permission-allow-once'));

    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith({
      requestId: 'r1',
      toolUseId: 'tu1',
      toolName: 'Bash',
      behavior: 'allow',
      updatedInput: { command: 'ls -la' },
    });
  });

  // --- Behavior 5: always-allow absent with no suggestions ---

  it('does not render always-allow button when suggestions array is empty', () => {
    wrap(<PermissionGate entry={makeEntry([])} reply={reply} />);
    expect(screen.queryByTestId('chat-permission-always-allow')).toBeNull();
  });

  // --- Behavior 6: always-allow present and functional with suggestions ---

  it('renders always-allow when suggestions are present and calls reply with updatedPermissions', () => {
    wrap(<PermissionGate entry={makeEntry([SUG])} reply={reply} />);
    expect(screen.getByTestId('chat-permission-always-allow')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('chat-permission-always-allow'));

    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith({
      requestId: 'r1',
      toolUseId: 'tu1',
      toolName: 'Bash',
      behavior: 'allow',
      updatedInput: { command: 'ls -la' },
      updatedPermissions: [SUG],
    });
  });
});

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

  // --- The payload dump sits on `bg-muted`, the same surface ToolFallback's args
  //     pre uses. It is JSON, not terminal output, so the terminal palette (which
  //     stays bridge-owned for real terminals) is the wrong material. ---

  it('the details JSON block sits on the muted payload surface, not the terminal palette', () => {
    wrap(<PermissionGate entry={makeEntry()} reply={reply} />);
    fireEvent.click(screen.getByTestId('chat-permission-details-toggle'));

    const pre = screen.getByTestId('chat-permission-details-pre');
    expect(pre).toHaveClass('bg-muted', 'text-foreground');
  });

  // --- Details reveal mounts with an enter transition ---

  it('the details JSON block mounts with an enter transition', () => {
    wrap(<PermissionGate entry={makeEntry()} reply={reply} />);
    fireEvent.click(screen.getByTestId('chat-permission-details-toggle'));

    expect(screen.getByTestId('chat-permission-details-pre')).toHaveClass('animate-in', 'fade-in-0');
  });

  // --- ToolNameRow/DetailsDisclosure indent aligns to the head's own title
  //     column: the px-4 gutter + the size-6 tile + the gap-2.5 between them,
  //     expressed once as GATE_BODY_INSET so the two cannot drift. ---

  it('the tool-name row aligns to the head title column via GATE_BODY_INSET', () => {
    wrap(<PermissionGate entry={makeEntry()} reply={reply} />);
    const row = screen.getByText('Bash').closest('div');
    expect(row).toHaveClass('pl-[calc(1rem+1.5rem+0.625rem)]');
    expect(row).not.toHaveClass('pl-12');
  });

  // --- disclosure chevron sits on the 12px step of the v2 scale ---

  it('the details chevron is sized on the v2 scale (size-3)', () => {
    wrap(<PermissionGate entry={makeEntry()} reply={reply} />);
    const toggle = screen.getByTestId('chat-permission-details-toggle');
    const chevron = toggle.querySelector('svg');
    expect(chevron).toHaveClass('size-3');
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

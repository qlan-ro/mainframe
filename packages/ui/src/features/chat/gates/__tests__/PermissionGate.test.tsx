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
 *  - The button set/order/labels come straight from `entry.options` — not a
 *    hardcoded triad — and are keyed by option id, not array index.
 *  - allow_once / allow_always / reject_once each call reply with the
 *    matching ControlResponse, keyed off `kind` alone (never optionId/name).
 *  - An option whose `kind` this build doesn't recognize still renders and is
 *    selectable — never dropped, never guessed as an approval (resolves to
 *    the same response as an explicit reject).
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ControlUpdate, PermissionOption, PermissionOptionKind } from '@qlan-ro/mainframe-types';
import type { ChatPermissionEntry } from '../../controller/chat-thread-state';
import { PermissionGate, type ReplyFn } from '../PermissionGate';
import { installGateLayout } from './gate-layout';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrap(ui: React.ReactElement) {
  return render(
    <TooltipProvider>
      <div data-chat-gate>{ui}</div>
    </TooltipProvider>,
  );
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

// Mirrors mainframe-acp/src/gates.rs::offered_options() — the daemon's real,
// always-offered vocabulary.
const STANDARD_OPTIONS: PermissionOption[] = [
  { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
  { optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' },
  { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
];

function makeEntry(
  options: PermissionOption[] = STANDARD_OPTIONS,
  suggestions: ControlUpdate[] = [],
): ChatPermissionEntry {
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
    options,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PermissionGate', () => {
  let reply: Mock<ReplyFn>;

  beforeEach(() => {
    reply = vi.fn<ReplyFn>();
    installGateLayout();
  });

  describe('an Artifact request', () => {
    const ARTIFACT = 'https://claude.ai/artifact/V1LAdjrXoKC7jVLpHnV1D2';

    function artifactEntry(input: Record<string, unknown>): ChatPermissionEntry {
      const entry = makeEntry();
      return { ...entry, request: { ...entry.request, toolName: 'Artifact', input } };
    }

    it('says what is being published, with its title', () => {
      wrap(
        <PermissionGate entry={artifactEntry({ type_url: `${ARTIFACT}x`, title: 'Coffee Pricing' })} reply={reply} />,
      );
      expect(screen.getByText('Create artifact: Coffee Pricing')).toBeInTheDocument();
    });

    it('hides the internal fields from the details', () => {
      wrap(
        <PermissionGate
          entry={artifactEntry({
            url: ARTIFACT,
            __artifactPublishTarget: ARTIFACT,
            __artifactRoomJoinDisclosed: false,
          })}
          reply={reply}
        />,
      );
      fireEvent.click(screen.getByTestId('chat-permission-details-toggle'));

      const details = screen.getByTestId('chat-permission-details-pre');
      expect(details).toHaveTextContent(ARTIFACT);
      expect(details).not.toHaveTextContent('__artifact');
    });
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
    expect(pre).toHaveClass('bg-code-surface', 'text-foreground');
  });

  // --- Details reveal mounts with an enter transition ---

  it('the details JSON block mounts with an enter transition', () => {
    wrap(<PermissionGate entry={makeEntry()} reply={reply} />);
    fireEvent.click(screen.getByTestId('chat-permission-details-toggle'));

    expect(screen.getByTestId('chat-permission-details-pre')).toHaveClass('animate-in', 'fade-in-0');
  });

  // --- disclosure chevron sits on the 12px step of the v2 scale ---

  it('the details chevron is sized on the v2 scale (size-3)', () => {
    wrap(<PermissionGate entry={makeEntry()} reply={reply} />);
    const toggle = screen.getByTestId('chat-permission-details-toggle');
    const chevron = toggle.querySelector('svg');
    expect(chevron).toHaveClass('size-3');
  });

  // --- Behavior 3: the button set/order/labels come from entry.options ---

  it('renders exactly one button per option, in request order, labeled and keyed by option id', () => {
    wrap(<PermissionGate entry={makeEntry()} reply={reply} />);

    const buttons = screen
      .getAllByRole('button')
      .filter((b) => b.dataset.testid?.startsWith('chat-permission-option-'));
    expect(buttons.map((b) => b.dataset.testid)).toEqual([
      'chat-permission-option-allow-once',
      'chat-permission-option-allow-always',
      'chat-permission-option-reject-once',
    ]);
    expect(buttons.map((b) => b.textContent)).toEqual(['Allow once', 'Always allow', 'Reject']);
  });

  it('renders the options in a different order when the request supplies a different order', () => {
    const reordered: PermissionOption[] = [
      { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
      { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
    ];
    wrap(<PermissionGate entry={makeEntry(reordered)} reply={reply} />);

    const buttons = screen
      .getAllByRole('button')
      .filter((b) => b.dataset.testid?.startsWith('chat-permission-option-'));
    expect(buttons.map((b) => b.dataset.testid)).toEqual([
      'chat-permission-option-reject-once',
      'chat-permission-option-allow-once',
    ]);
  });

  it('renders only what the request offers — no options means no option buttons', () => {
    wrap(<PermissionGate entry={makeEntry([])} reply={reply} />);
    const buttons = screen.queryAllByTestId(/^chat-permission-option-/);
    expect(buttons).toHaveLength(0);
  });

  // --- Behavior 4: clicking a known-kind option sends the matching response ---

  it('clicking the allow_once option calls reply with the allow ControlResponse including updatedInput', () => {
    wrap(<PermissionGate entry={makeEntry()} reply={reply} />);
    fireEvent.click(screen.getByTestId('chat-permission-option-allow-once'));

    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith(
      {
        requestId: 'r1',
        toolUseId: 'tu1',
        toolName: 'Bash',
        behavior: 'allow',
        updatedInput: { command: 'ls -la' },
      },
      'allow-once',
    );
  });

  it('clicking the allow_always option calls reply with updatedPermissions from entry.request.suggestions', () => {
    wrap(<PermissionGate entry={makeEntry(STANDARD_OPTIONS, [SUG])} reply={reply} />);
    fireEvent.click(screen.getByTestId('chat-permission-option-allow-always'));

    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith(
      {
        requestId: 'r1',
        toolUseId: 'tu1',
        toolName: 'Bash',
        behavior: 'allow',
        updatedInput: { command: 'ls -la' },
        updatedPermissions: [SUG],
      },
      'allow-always',
    );
  });

  it('clicking the reject_once option calls reply with the deny ControlResponse', () => {
    wrap(<PermissionGate entry={makeEntry()} reply={reply} />);
    fireEvent.click(screen.getByTestId('chat-permission-option-reject-once'));

    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith(
      {
        requestId: 'r1',
        toolUseId: 'tu1',
        toolName: 'Bash',
        behavior: 'deny',
      },
      'reject-once',
    );
  });

  // --- Behavior 5: kind drives styling, id/name never do ---

  it('renders allow_once primary, allow_always outline, and reject_once destructive — by kind, not id/name', () => {
    // Deliberately mismatched id/name so a bug that keys off them would show up here.
    const scrambled: PermissionOption[] = [
      { optionId: 'reject-once', name: 'Reject', kind: 'allow_once' },
      { optionId: 'allow-once', name: 'Allow once', kind: 'reject_once' },
      { optionId: 'x', name: 'Always', kind: 'allow_always' },
    ];
    wrap(<PermissionGate entry={makeEntry(scrambled)} reply={reply} />);

    expect(screen.getByTestId('chat-permission-option-reject-once')).toHaveAttribute('data-variant', 'default');
    expect(screen.getByTestId('chat-permission-option-x')).toHaveAttribute('data-variant', 'outline');
    expect(screen.getByTestId('chat-permission-option-allow-once')).toHaveAttribute('data-variant', 'destructive');
  });

  // --- Behavior 6: an unrecognized kind still renders and is selectable ---

  it('an option with an unrecognized kind still renders, is clickable, and never resolves to approval', () => {
    const withUnknown: PermissionOption[] = [
      ...STANDARD_OPTIONS,
      { optionId: 'do-something-new', name: 'Do Something New', kind: 'nonstandard_kind' as PermissionOptionKind },
    ];
    wrap(<PermissionGate entry={makeEntry(withUnknown)} reply={reply} />);

    const unknownButton = screen.getByTestId('chat-permission-option-do-something-new');
    expect(unknownButton).toBeInTheDocument();
    expect(unknownButton).toBeEnabled();
    expect(unknownButton).toHaveTextContent('Do Something New');
    expect(unknownButton).toHaveAttribute('data-variant', 'secondary');

    fireEvent.click(unknownButton);

    expect(reply).toHaveBeenCalledTimes(1);
    // The response degrades to deny (unknown is never approval), but the
    // clicked option's own id still travels with the answer.
    expect(reply).toHaveBeenCalledWith(
      {
        requestId: 'r1',
        toolUseId: 'tu1',
        toolName: 'Bash',
        behavior: 'deny',
      },
      'do-something-new',
    );
  });
});

describe('PermissionGate — redesigned content (G1, G2, G5)', () => {
  const reply = vi.fn<ReplyFn>();

  it('shows the command a Bash request runs, without opening the details', () => {
    wrap(<PermissionGate entry={makeEntry()} reply={reply} />);

    expect(screen.getByTestId('chat-permission-command')).toHaveTextContent('ls -la');
    expect(screen.queryByTestId('chat-permission-details-pre')).toBeNull();
  });

  it('shows no command line for a request without a command', () => {
    const entry = makeEntry();
    entry.request.input = { path: '/tmp/x' };

    wrap(<PermissionGate entry={entry} reply={reply} />);

    expect(screen.queryByTestId('chat-permission-command')).toBeNull();
  });

  it('names the rule "Always allow" will save on that button, and only there', () => {
    wrap(<PermissionGate entry={makeEntry(STANDARD_OPTIONS, [SUG])} reply={reply} />);

    const rule = screen.getByTestId('chat-permission-rule');
    expect(rule).toHaveTextContent('git:*');
    expect(screen.getByTestId('chat-permission-option-allow-always')).toContainElement(rule);
    expect(screen.getByTestId('chat-permission-option-allow-once')).not.toContainElement(rule);
  });

  it('names no rule when the CLI suggested none', () => {
    wrap(<PermissionGate entry={makeEntry()} reply={reply} />);

    expect(screen.queryByTestId('chat-permission-rule')).toBeNull();
  });

  it('eyebrow is just "Permission required" for the session itself', () => {
    wrap(<PermissionGate entry={makeEntry()} reply={reply} />);

    expect(screen.getByText('Permission required')).toBeInTheDocument();
    expect(screen.getByText('Permission Required')).toBeInTheDocument();
  });

  it('eyebrow names the asker and "· N more waiting"; the title is what the asker is doing', () => {
    wrap(
      <PermissionGate
        entry={makeEntry()}
        reply={reply}
        context={{ asker: 'code-reviewer', title: 'Review the diff', more: 2 }}
      />,
    );

    expect(screen.getByText('Permission required · code-reviewer · 2 more waiting')).toBeInTheDocument();
    expect(screen.getByText('Review the diff')).toBeInTheDocument();
  });

  it('leaves "more waiting" out when nothing waits behind it', () => {
    wrap(<PermissionGate entry={makeEntry()} reply={reply} context={{ asker: 'code-reviewer', more: 0 }} />);

    expect(screen.getByText('Permission required · code-reviewer')).toBeInTheDocument();
  });
});

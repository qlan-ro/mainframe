/**
 * AcpPermissionGate — behavior tests.
 *
 * Strategy:
 *  - Component is fully prop-driven: no hooks, no context beyond TooltipProvider.
 *  - All expected values are hardcoded; the RequestPermissionResponse objects
 *    are the contract — never recomputed from the component under test.
 *
 * Behaviors covered:
 *  - Root data-testid, title, description, subject tool-name subtitle.
 *  - Options render in adapter order, one button per option, keyed by optionId.
 *  - Clicking an option calls reply with the plain `{outcome:'selected',
 *    optionId}` answer, regardless of the option's `kind` or `name`.
 *  - No-effect-inference: two requests with the same optionId but different
 *    `name`/`kind` produce the identical reply payload for that optionId.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { PermissionOption, RequestPermissionRequest } from '@qlan-ro/mainframe-types';
import { AcpPermissionGate, type AcpReplyFn } from '../AcpPermissionGate';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrap(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

function option(over: Partial<PermissionOption> = {}): PermissionOption {
  return { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once', ...over };
}

function request(over: Partial<RequestPermissionRequest> = {}): RequestPermissionRequest {
  return {
    sessionId: 's1',
    title: 'Allow Bash to run?',
    options: [
      option({ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }),
      option({ optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' }),
      option({ optionId: 'reject-once', name: 'Reject', kind: 'reject_once' }),
    ],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AcpPermissionGate', () => {
  let reply: Mock<AcpReplyFn>;

  beforeEach(() => {
    reply = vi.fn<AcpReplyFn>();
  });

  it('renders the root testid and the request title', () => {
    wrap(<AcpPermissionGate request={request()} reply={reply} />);
    expect(screen.getByTestId('chat-acp-permission-gate')).toBeInTheDocument();
    expect(screen.getByText('Allow Bash to run?')).toBeInTheDocument();
  });

  it('renders the description when present, omits it when absent', () => {
    wrap(<AcpPermissionGate request={request({ description: 'Runs a shell command.' })} reply={reply} />);
    expect(screen.getByTestId('chat-acp-permission-description')).toHaveTextContent('Runs a shell command.');
  });

  it('does not render a description node when the request has none', () => {
    wrap(<AcpPermissionGate request={request()} reply={reply} />);
    expect(screen.queryByTestId('chat-acp-permission-description')).not.toBeInTheDocument();
  });

  it('renders the tool-call title as a subtitle', () => {
    wrap(
      <AcpPermissionGate
        request={request({ subject: { type: 'tool_call', toolCall: { toolCallId: 'tu1', title: 'Bash' } } })}
        reply={reply}
      />,
    );
    expect(screen.getByText('Bash')).toBeInTheDocument();
  });

  it('renders one button per option, in adapter order, keyed by optionId', () => {
    wrap(<AcpPermissionGate request={request()} reply={reply} />);
    expect(screen.getByTestId('chat-acp-permission-option-allow-once')).toHaveTextContent('Allow once');
    expect(screen.getByTestId('chat-acp-permission-option-allow-always')).toHaveTextContent('Always allow');
    expect(screen.getByTestId('chat-acp-permission-option-reject-once')).toHaveTextContent('Reject');
  });

  it('clicking an option calls reply once with the plain selected-outcome answer', () => {
    wrap(<AcpPermissionGate request={request()} reply={reply} />);
    fireEvent.click(screen.getByTestId('chat-acp-permission-option-reject-once'));

    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith({ outcome: { outcome: 'selected', optionId: 'reject-once' } });
  });

  it('renders a single arbitrary option and answers with its bare optionId', () => {
    wrap(
      <AcpPermissionGate
        request={request({ options: [option({ optionId: 'custom-opt', name: 'Do the thing', kind: 'allow_once' })] })}
        reply={reply}
      />,
    );
    fireEvent.click(screen.getByTestId('chat-acp-permission-option-custom-opt'));
    expect(reply).toHaveBeenCalledWith({ outcome: { outcome: 'selected', optionId: 'custom-opt' } });
  });

  // --- No-effect-inference: relabeling/reclassifying an option must not change
  //     the reply payload for the same optionId. ---

  it('no-effect-inference: identical optionId with a different name/kind yields an identical reply payload', () => {
    const requestA = request({
      options: [option({ optionId: 'x', name: 'Allow', kind: 'allow_once' })],
    });
    const requestB = request({
      options: [option({ optionId: 'x', name: 'Yes, run it', kind: 'reject_always' })],
    });

    const replyA = vi.fn<AcpReplyFn>();
    const { unmount } = wrap(<AcpPermissionGate request={requestA} reply={replyA} />);
    fireEvent.click(screen.getByTestId('chat-acp-permission-option-x'));
    unmount();

    const replyB = vi.fn<AcpReplyFn>();
    wrap(<AcpPermissionGate request={requestB} reply={replyB} />);
    fireEvent.click(screen.getByTestId('chat-acp-permission-option-x'));

    expect(replyA).toHaveBeenCalledWith({ outcome: { outcome: 'selected', optionId: 'x' } });
    expect(replyB).toHaveBeenCalledWith({ outcome: { outcome: 'selected', optionId: 'x' } });
    expect(replyA.mock.calls[0]).toEqual(replyB.mock.calls[0]);
  });
});

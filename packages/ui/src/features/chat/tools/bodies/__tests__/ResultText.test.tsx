import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ToolPart } from '../../../view-model/turn/types';
import { NestedTranscriptScope, SubagentTranscriptScope } from '../../../messages/turn/transcript-scope';
import { ResultText } from '../ResultText';

vi.mock('../../chat-tool-context', () => ({ useChatId: () => 'chat' }));
vi.mock('../../ToolResultExpand', () => ({
  ToolResultExpand: ({ chatId, toolUseId, agentId }: { chatId: string; toolUseId: string; agentId?: string }) => (
    <div data-testid="expand">{`${chatId}:${toolUseId}:${agentId ?? 'own'}`}</div>
  ),
}));

const part = {
  type: 'tool-call',
  toolCallId: 'call',
  toolName: 'Read',
  args: {},
  argsText: '',
  result: { content: 'first lines', truncated: true, fullBytes: 9000 },
  status: { type: 'complete' },
} as unknown as ToolPart;

describe('ResultText expansion source', () => {
  it("reads a cut result from the chat's own transcript", () => {
    render(<ResultText part={part} />);
    expect(screen.getByTestId('expand').textContent).toBe('chat:call:own');
  });

  it("reads a cut result inside a saved sub-agent from that agent's transcript", () => {
    render(
      <SubagentTranscriptScope subagentId="worker">
        <ResultText part={part} />
      </SubagentTranscriptScope>,
    );
    expect(screen.getByTestId('expand').textContent).toBe('chat:call:worker');
  });

  it("reads a delegated task's results from its own chat, not the surrounding sub-agent", () => {
    render(
      <SubagentTranscriptScope subagentId="worker">
        <NestedTranscriptScope messageId="m" toolCallId="t" live={false} cancelled={false} chatId="task-chat">
          <ResultText part={part} />
        </NestedTranscriptScope>
      </SubagentTranscriptScope>,
    );
    expect(screen.getByTestId('expand').textContent).toBe('chat:call:own');
  });
});

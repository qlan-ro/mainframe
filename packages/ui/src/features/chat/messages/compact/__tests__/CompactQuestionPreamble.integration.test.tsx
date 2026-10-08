import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import type { ThreadAssistantMessage } from '@assistant-ui/react';
import type { TranscriptPresentation } from '@qlan-ro/mainframe-types';
import { useUiPrefs } from '@/store/ui-prefs';
import { fixtureMessage, fixtureTool } from './fixtures';
import { TurnFixture, turnMessage, turnSource } from './turn-fixtures';

const preamble = 'The screenshot was taken before the reply arrived.';
const claude: Partial<TranscriptPresentation> = { provider: 'claude', turnId: 'question-turn' };

function questionMessage(state: TranscriptPresentation['state']): ThreadAssistantMessage {
  const message = fixtureMessage(
    [
      { type: 'text', text: preamble },
      fixtureTool({
        toolCallId: 'question',
        toolName: 'AskUserQuestion',
        args: {
          questions: [
            {
              question: 'How should I handle the screenshot?',
              header: 'Fix comment',
              options: [
                { label: 'Re-run', description: 'Run QA again' },
                { label: 'Leave it', description: 'Change nothing' },
              ],
              multiSelect: false,
            },
          ],
        },
        result: undefined,
      }),
    ],
    'asked',
    state === 'running',
  );
  const tool = turnSource('asked', 0, 0, { ...claude, state });
  return {
    ...message,
    metadata: {
      ...message.metadata,
      custom: {
        mainframe: {
          partSources: {
            0: [turnSource('asked', 0, preamble.length, { ...claude, state })],
            1: [{ ...tool, sourceBlockIndex: 1, startUtf16: undefined, endUtf16: undefined }],
          },
        },
      },
    },
  };
}

beforeEach(() => useUiPrefs.getState().setTranscriptMode('compact'));
it('shows text written before a pending AskUserQuestion above the question card', async () => {
  render(<TurnFixture rootId="question-pending" pending={['question']} messages={[questionMessage('running')]} />);
  const text = await screen.findByText(preamble);
  const card = screen.getByTestId('chat-ask-card');
  expect(text).toBeVisible();
  expect(card).toBeVisible();
  expect(text.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
it('keeps the answered question visible and the preamble under work details once the turn completes', async () => {
  const final = turnMessage('final', 'Final answer', {
    ...claude,
    state: 'completed',
    phase: 'final_answer',
    finalEligible: true,
  });
  render(<TurnFixture rootId="question-done" messages={[questionMessage('completed'), final]} />);
  expect(screen.getByTestId('chat-ask-card')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Work details' }));
  expect(await screen.findByText(preamble)).toBeVisible();
});

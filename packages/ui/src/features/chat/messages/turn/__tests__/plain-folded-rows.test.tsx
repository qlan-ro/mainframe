// @vitest-environment jsdom
/**
 * #517: on the plain list a folded turn's messages that draw nothing get no row. A Claude turn sends one message per
 * model response, so a large chat's folded turns held thousands of empty 1 px rows, and an older page mounted them
 * all in one frame (842 ms for a page of 1,510 messages in the rig's WKWebView `S-top-heavy-flick`).
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUiPrefs } from '@/store/ui-prefs';
import type { TranscriptScrollController } from '../../../thread/transcript-scroll-context';
import { TurnFixture, assistant, bash, text, user } from './fixtures';

vi.mock('../../AssistantForkAction', () => ({ AssistantForkAction: () => null }));

const plain: TranscriptScrollController = {
  owned: true,
  viewportElement: { current: null },
  isFollowing: () => true,
  beginInteraction: () => () => undefined,
};

/** One finished turn: a prompt, `steps` messages of one tool call each, then the answer. */
const turn = (steps: number) => [
  user('Go', 'u1'),
  ...Array.from({ length: steps }, (_, i) => assistant([bash(`b${i}`, `ls ${i}`)], `a${i}`)),
  assistant([text('Done.')], 'answer'),
];
const assistantRows = () => screen.queryAllByTestId('chat-assistant-message').map((row) => row.dataset.messageId);

let roots = 0;
beforeEach(() => {
  useUiPrefs.setState({ finishedWork: 'fold' });
  roots++;
});

describe('a folded turn on the plain list', () => {
  it('draws only the messages that show something, and every message once it is opened', () => {
    render(<TurnFixture rootId={`fold-${roots}`} messages={turn(6)} scroll={plain} isRunning={false} />);
    expect(assistantRows()).toEqual(['a0', 'answer']);
    act(() => fireEvent.click(screen.getByTestId(/^chat-work-toggle-/)));
    expect(assistantRows()).toEqual(['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'answer']);
  });

  it('keeps a message the transcript dates', () => {
    const messages = turn(3);
    messages[2] = { ...messages[2]!, createdAt: new Date(messages[1]!.createdAt!.getTime() + 31 * 60_000) };
    messages[3] = { ...messages[3]!, createdAt: messages[2]!.createdAt };
    messages[4] = { ...messages[4]!, createdAt: messages[2]!.createdAt };
    render(<TurnFixture rootId={`dated-${roots}`} messages={messages} scroll={plain} isRunning={false} />);
    expect(assistantRows()).toEqual(['a0', 'a1', 'answer']);
  });

  it('leaves the other list’s empty rows alone (it measures every row)', () => {
    render(<TurnFixture rootId={`virtual-${roots}`} messages={turn(6)} isRunning={false} />);
    expect(assistantRows()).toEqual(['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'answer']);
  });
});

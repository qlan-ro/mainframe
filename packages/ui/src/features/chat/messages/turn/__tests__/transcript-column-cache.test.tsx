/** The real transcript in the chat column keeps its chat's turns across a switch (todo #491). */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PanelColumnContext } from '@/features/session-panel/panel-control-store';
import { chatControllerRegistry } from '@/features/sessions/runtime/chat-controller-registry';
import { useUiPrefs } from '@/store/ui-prefs';
import { buildChatExtras } from '../../../runtime/chat-extras';
import { createChatThreadState, type ChatThreadState } from '../../../controller/chat-thread-state';
import type { AcpChatController } from '../../../controller/acp-chat-controller';
import { releaseTranscriptViewModels, transcriptViewModels } from '../use-transcript-turns';
import { TurnFixture, assistant, text, user } from './fixtures';

vi.mock('../../AssistantForkAction', () => ({ AssistantForkAction: () => null }));
vi.mock('@/lib/api/background-tasks', () => ({
  listBackgroundTasks: vi.fn().mockResolvedValue([]),
  readBackgroundTaskOutput: vi.fn().mockResolvedValue(''),
}));

const CHAT = 'chat-column';

/** What the cache reads of a controller: its window, and a way to hear it change. */
function fakeController() {
  let state: ChatThreadState = {
    ...createChatThreadState(CHAT),
    historyWindow: { hasMore: true, loading: false, floorItemId: 'u2' },
  };
  const listeners = new Set<() => void>();
  const controller = {
    getState: () => state,
    subscribeState: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as AcpChatController;
  const set = (next: Partial<ChatThreadState>) => {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
  };
  return { controller, set };
}

const extras = buildChatExtras({} as AcpChatController, 31415, createChatThreadState(CHAT));
const recent = [user('Second question', 'u2'), assistant([text('Second answer')], 'a2')];
let roots = 0;

function Column({ messages, column = true }: { messages: typeof recent; column?: boolean }) {
  const fixture = <TurnFixture rootId={`column-${roots}`} messages={messages} extras={extras} />;
  return column ? <PanelColumnContext.Provider value="main">{fixture}</PanelColumnContext.Provider> : fixture;
}

let fake: ReturnType<typeof fakeController>;
beforeEach(() => {
  roots++;
  useUiPrefs.setState({ finishedWork: 'fold' });
  fake = fakeController();
  vi.spyOn(chatControllerRegistry, 'get').mockImplementation((id) => (id === CHAT ? fake.controller : undefined));
});
afterEach(() => {
  releaseTranscriptViewModels(fake.controller);
  vi.restoreAllMocks();
});

it('keeps the chat’s turns when the column switches away, and draws the same rows on return', () => {
  const first = render(<Column messages={recent} />);
  expect(screen.getByText('Second answer')).toBeVisible();
  expect(transcriptViewModels.size).toBe(1);
  const kept = transcriptViewModels.bytes;
  first.unmount();
  // Off screen and unchanged: still kept.
  expect(transcriptViewModels.size).toBe(1);
  render(<Column messages={recent} />);
  expect(screen.getByText('Second answer')).toBeVisible();
  expect(transcriptViewModels.size).toBe(1);
  expect(transcriptViewModels.bytes).toBe(kept);
});

it('draws the window the chat has now after an older page landed while it was away', () => {
  render(<Column messages={recent} />).unmount();
  act(() => fake.set({ historyWindow: { hasMore: false, loading: false, floorItemId: 'u1' } }));
  expect(transcriptViewModels.size).toBe(0);
  const older = [user('First question', 'u1'), assistant([text('First answer')], 'a1'), ...recent];
  render(<Column messages={older} />);
  expect(screen.getByText('First answer')).toBeVisible();
  expect(screen.getByText('Second answer')).toBeVisible();
});

it('leaves the registry alone outside the chat column', () => {
  render(<Column messages={recent} column={false} />);
  expect(screen.getByText('Second answer')).toBeVisible();
  expect(chatControllerRegistry.get).not.toHaveBeenCalled();
  expect(transcriptViewModels.size).toBe(0);
});

import { expect, it } from 'vitest';
import { restoreConversations, scrubLegacyConversationTabs, takeConversations } from '../conversation-tabs-persist';
import type { RunState, RunTab } from '../run-pane';

const large = 'Nested transcript text';
const legacy = {
  id: 'agent-inner',
  kind: 'agent',
  title: 'Nested'.repeat(100),
  chatId: 'chat',
  toolCallId: 'inner',
  messageId: 'message',
  savedNestedCall: {
    type: 'tool-call',
    toolCallId: 'inner',
    toolName: 'Agent',
    args: { prompt: large },
    argsText: large,
    result: large,
    providerMetadata: {
      mainframe: { subagentFact: { status: 'failed', summary: large, nativeAgentId: 'native-inner' } },
    },
  },
} satisfies RunTab;

const topLevel = {
  id: 'agent-outer',
  kind: 'agent',
  title: 'Outer agent',
  chatId: 'chat',
  toolCallId: 'outer',
} satisfies RunTab;

const run: RunState = {
  dir: 'h',
  flex: [1],
  panes: [{ id: 'pane', tabs: [topLevel, legacy], active: legacy.id }],
};

it('persists the top-level agent and omits the nested tab and its layout references', () => {
  const saved = takeConversations(run);
  expect(saved?.panes[0]).toEqual({ id: 'pane', order: [topLevel.id], tabs: [topLevel], active: null });
  expect(restoreConversations(null, saved)?.panes[0]).toEqual({
    id: 'pane',
    tabs: [topLevel],
    active: topLevel.id,
  });
});

it.each([
  legacy,
  {
    ...topLevel,
    id: legacy.id,
    savedNestedLocator: { parentNativeId: null, nativeAgentId: 'native-inner' },
  },
])('drops legacy nested tabs on load', (nested) => {
  const pane = { id: 'pane', tabs: [topLevel, nested], active: nested.id, order: [topLevel.id, nested.id] };
  const stored = { chat: { ...run, panes: [pane] } };
  const migrated = scrubLegacyConversationTabs(stored);
  expect(migrated).toEqual({ chat: takeConversations(run) });
  expect(scrubLegacyConversationTabs(migrated)).toBe(migrated);
  expect(restoreConversations(null, stored.chat)?.panes[0]?.tabs).toEqual([topLevel]);
});

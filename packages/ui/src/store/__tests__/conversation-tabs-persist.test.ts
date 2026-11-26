import { expect, it } from 'vitest';
import { restoreConversations, scrubLegacyConversationTabs, takeConversations } from '../conversation-tabs-persist';
import type { RunState, RunTab } from '../run-pane';

const large = 'transcript text'.repeat(100_000);
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

const run = (tab: RunTab): RunState => ({
  dir: 'h',
  flex: [1],
  panes: [{ id: 'pane', tabs: [tab], active: tab.id }],
});

it('serializes a bounded locator and never copies the nested transcript payload', () => {
  const saved = takeConversations(
    run({
      ...legacy,
      savedNestedLocator: { parentNativeId: 'native-outer', nativeAgentId: 'native-inner' },
    }),
  );
  const serialized = JSON.stringify(saved);
  expect(new TextEncoder().encode(serialized).length).toBeLessThan(512);
  expect(serialized).not.toMatch(/args|result|summary|subagentFact|savedNestedCall/);
  expect(restoreConversations(null, JSON.parse(serialized))?.panes[0]?.tabs[0]).toEqual({
    id: legacy.id,
    kind: legacy.kind,
    title: legacy.title.slice(0, 120),
    chatId: legacy.chatId,
    toolCallId: legacy.toolCallId,
    savedNestedLocator: { parentNativeId: 'native-outer', nativeAgentId: 'native-inner' },
  });
});

it('scrubs legacy stored payloads and preserves the available IDs on load', () => {
  const stored = { chat: { ...run(legacy), panes: [{ ...run(legacy).panes[0], order: [legacy.id] }] } };
  const migrated = scrubLegacyConversationTabs(stored);
  expect(JSON.stringify(migrated)).not.toMatch(/args|result|summary|subagentFact|savedNestedCall/);
  expect(restoreConversations(null, stored.chat)?.panes[0]?.tabs[0]).toEqual(
    expect.objectContaining({
      title: legacy.title.slice(0, 120),
      savedNestedLocator: { parentNativeId: null, nativeAgentId: 'native-inner' },
    }),
  );
  expect(scrubLegacyConversationTabs(migrated)).toBe(migrated);
});

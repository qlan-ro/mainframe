// packages/core/src/plugins/builtin/codex/spawn-handler.ts
//
// Handles `collab_agent_spawn_begin` / `collab_agent_spawn_end` notifications
// and routes child-thread `item/completed` events under a `_TaskGroup` card.
//
// Protocol confirmed via binary reverse-engineering of Codex 0.125.0:
//   collab_agent_spawn_begin: { threadId, turnId, itemId, prompt, receiverThreadIds }
//   collab_agent_spawn_end:   { threadId, turnId, itemId, newThreadId, newAgentNickname,
//                               newAgentRole, prompt, handoffId, activeTranscript }
import { nanoid } from 'nanoid';
import type { SessionSink } from '@qlan-ro/mainframe-types';
import type { ItemCompletedParams, CollabAgentSpawnBeginParams, CollabAgentSpawnEndParams } from './types.js';
import type { CodexSessionState } from './event-mapper.js';
import { createChildLogger } from '../../../logger.js';

const log = createChildLogger('codex:spawn');

export function handleSpawnBegin(
  params: CollabAgentSpawnBeginParams,
  sink: SessionSink,
  state: CodexSessionState,
): void {
  const parentToolUseId = nanoid();

  if (!state.activeSpawns) {
    state.activeSpawns = new Map();
  }

  const childThreadId = params.receiverThreadIds[0] ?? params.itemId;
  state.activeSpawns.set(childThreadId, {
    parentToolUseId,
    childThreadId,
    prompt: params.prompt,
  });

  sink.onMessage([
    {
      type: 'tool_use',
      id: parentToolUseId,
      name: '_TaskGroup',
      input: { prompt: params.prompt, agentNickname: null },
    },
  ]);
}

export function handleSpawnEnd(params: CollabAgentSpawnEndParams, sink: SessionSink, state: CodexSessionState): void {
  const spawnState = state.activeSpawns?.get(params.newThreadId);
  if (!spawnState) {
    log.debug({ newThreadId: params.newThreadId }, 'codex: collab_agent_spawn_end with no matching spawn begin');
    return;
  }

  state.activeSpawns!.delete(params.newThreadId);

  sink.onToolResult([
    {
      type: 'tool_result',
      toolUseId: spawnState.parentToolUseId,
      content: params.newAgentNickname ?? 'Sub-agent completed',
      isError: false,
    },
  ]);
}

/**
 * Emit an item/completed event tagged with a parentToolUseId (child thread routing).
 * Uses a proxy sink so all emitted blocks are automatically tagged.
 */
export function routeChildItem(
  item: ItemCompletedParams['item'],
  parentToolUseId: string,
  sink: SessionSink,
  handleItem: (params: ItemCompletedParams, sink: SessionSink, state: CodexSessionState) => void,
  state: CodexSessionState,
): void {
  const taggedSink: SessionSink = {
    ...sink,
    onMessage: (blocks) => {
      sink.onMessage(blocks.map((b) => ({ ...b, parentToolUseId })));
    },
    onToolResult: (results) => {
      sink.onToolResult(results.map((r) => ({ ...r, parentToolUseId })));
    },
  };

  // Pass empty threadId so the child-routing check in handleItemCompleted won't recurse.
  handleItem({ threadId: '', turnId: '', item }, taggedSink, state);
}

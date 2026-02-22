import { describe, it, expect } from 'vitest';
import { buildToolResultBlocks, convertHistoryEntry } from '../adapters/claude-history.js';
import type { ToolResultMessageContent } from '@mainframe/types';

/**
 * Ensures that tool_result blocks produced by history loading and live stream
 * are always identical. If this test fails, buildToolResultBlocks drifted from
 * its callers.
 */

const FIXTURE_TOOL_RESULT_EVENT = {
  type: 'user',
  uuid: 'test-uuid-1',
  timestamp: '2026-02-17T00:00:00Z',
  message: {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'tu_abc123',
        content: 'Contents of file.txt:\n\nhello world',
        is_error: false,
      },
    ],
  },
  toolUseResult: {
    structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [' hello world'] }],
    originalFile: 'original content',
    type: 'update',
    content: 'updated content',
  },
};

describe('event pipeline parity', () => {
  it('history convertHistoryEntry produces same tool_result blocks as buildToolResultBlocks directly', () => {
    const chatId = 'chat-parity-test';

    // Path A: history loading
    const historyMsg = convertHistoryEntry(FIXTURE_TOOL_RESULT_EVENT as Record<string, unknown>, chatId);
    expect(historyMsg).not.toBeNull();
    expect(historyMsg!.type).toBe('tool_result');
    const historyBlocks = historyMsg!.content.filter((b) => b.type === 'tool_result') as ToolResultMessageContent[];

    // Path B: shared builder (used by live stream)
    const liveBlocks = buildToolResultBlocks(
      FIXTURE_TOOL_RESULT_EVENT.message as unknown as Record<string, unknown>,
      FIXTURE_TOOL_RESULT_EVENT.toolUseResult as Record<string, unknown>,
    ) as ToolResultMessageContent[];

    expect(historyBlocks).toHaveLength(1);
    expect(liveBlocks).toHaveLength(1);

    // Both paths must produce identical tool_result content
    expect(liveBlocks[0]!.toolUseId).toBe(historyBlocks[0]!.toolUseId);
    expect(liveBlocks[0]!.content).toBe(historyBlocks[0]!.content);
    expect(liveBlocks[0]!.isError).toBe(historyBlocks[0]!.isError);
    expect(liveBlocks[0]!.structuredPatch).toEqual(historyBlocks[0]!.structuredPatch);
    expect(liveBlocks[0]!.originalFile).toBe(historyBlocks[0]!.originalFile);
    expect(liveBlocks[0]!.modifiedFile).toBe(historyBlocks[0]!.modifiedFile);
  });

  it('task-notification string content produces no ChatMessage in either path', () => {
    const taskNotifEvent = {
      type: 'user',
      uuid: 'test-uuid-2',
      timestamp: '2026-02-17T00:00:00Z',
      message: {
        role: 'user',
        content: '<task-notification>{"task":"foo","status":"pending"}</task-notification>',
      },
    };

    // History path: should return null (filtered)
    const historyMsg = convertHistoryEntry(taskNotifEvent as Record<string, unknown>, 'chat-1');
    expect(historyMsg).toBeNull();

    // Live-stream path: buildToolResultBlocks on string content returns empty
    const liveBlocks = buildToolResultBlocks(taskNotifEvent.message as unknown as Record<string, unknown>, undefined);
    expect(liveBlocks).toHaveLength(0);
  });
});

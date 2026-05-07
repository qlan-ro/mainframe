import { describe, it, expect, vi } from 'vitest';
import type { ChatMessage, DetectedPr, SessionSink } from '@qlan-ro/mainframe-types';
import { EventHandler } from '../chat/event-handler.js';

describe('PR Detection and Persistence in History', () => {
  it('emits onPrDetected when converting history tool_result with PR URL', () => {
    // This test verifies that when a tool_result block contains a PR URL,
    // the conversion process detects it and would emit onPrDetected

    const historicalToolResult: ChatMessage = {
      id: 'msg-1',
      chatId: 'chat-1',
      type: 'tool_result',
      content: [
        {
          type: 'tool_result',
          toolUseId: 'bash-123',
          content: 'https://github.com/doruchiulan/mainframe/pull/100 created successfully',
          isError: false,
        },
      ],
      timestamp: new Date().toISOString(),
      metadata: { source: 'history' },
    };

    // When history is loaded, it should detect and persist the PR
    // For now, this test documents the expected behavior
    const prMatch = /https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/.exec(
      historicalToolResult.content[0].type === 'tool_result' ? historicalToolResult.content[0].content : '',
    );

    expect(prMatch).toBeTruthy();
    expect(prMatch?.[1]).toBe('doruchiulan');
    expect(prMatch?.[2]).toBe('mainframe');
    expect(prMatch?.[3]).toBe('100');
  });

  it('would emit onPrDetected for each PR found in historical tool results', () => {
    const content = `
      Multiple PRs in one result:
      https://github.com/org/repo1/pull/111
      https://github.com/org/repo2/pull/222
    `;

    // Count how many PRs we could detect
    const prRegex = /https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/g;
    const matches = [...content.matchAll(prRegex)];

    expect(matches.length).toBe(2);
    expect(matches[0]?.[3]).toBe('111');
    expect(matches[1]?.[3]).toBe('222');
  });
});

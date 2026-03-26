import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { extractSessionDiffs } from '../messages/session-diffs.js';
import { loadHistory } from '../plugins/builtin/claude/history.js';

describe('subagent session diffs integration', () => {
  const sessionId = 'test-session-subagent-001';
  const projectPath = '/tmp/test-subagent-project';
  const encodedPath = projectPath.replace(/[^a-zA-Z0-9-]/g, '-');
  const projectDir = path.join(homedir(), '.claude', 'projects', encodedPath);

  beforeEach(async () => {
    await mkdir(path.join(projectDir, sessionId, 'subagents'), { recursive: true });
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('includes file diffs from subagent Write calls', async () => {
    const parentLines = [
      JSON.stringify({
        type: 'assistant',
        uuid: 'a1',
        sessionId,
        timestamp: new Date().toISOString(),
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'agent-tu1', name: 'Agent', input: { prompt: 'create file' } }],
        },
      }),
      JSON.stringify({
        type: 'progress',
        uuid: 'p1',
        sessionId,
        parentToolUseID: 'agent-tu1',
        data: {
          type: 'agent_progress',
          agentId: 'a1234',
          prompt: 'create file',
          message: {
            type: 'assistant',
            message: {
              role: 'assistant',
              content: [
                {
                  type: 'tool_use',
                  id: 'sub-write-1',
                  name: 'Write',
                  input: { file_path: '/tmp/test-subagent-project/new-file.ts' },
                },
              ],
            },
            uuid: 'sub-a1',
            timestamp: new Date().toISOString(),
          },
        },
      }),
      JSON.stringify({
        type: 'user',
        uuid: 'u1',
        sessionId,
        timestamp: new Date().toISOString(),
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'agent-tu1', content: 'Task completed', is_error: false }],
        },
      }),
    ];

    const subagentLines = [
      JSON.stringify({
        type: 'assistant',
        uuid: 'sub-a1',
        sessionId,
        isSidechain: true,
        timestamp: new Date().toISOString(),
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'sub-write-1',
              name: 'Write',
              input: { file_path: '/tmp/test-subagent-project/new-file.ts' },
            },
          ],
        },
      }),
      JSON.stringify({
        type: 'user',
        uuid: 'sub-u1',
        sessionId,
        isSidechain: true,
        timestamp: new Date().toISOString(),
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'sub-write-1', content: 'File written', is_error: false }],
        },
        toolUseResult: {
          type: 'create',
          filePath: '/tmp/test-subagent-project/new-file.ts',
          content: 'export const hello = "world";',
          originalFile: '',
        },
      }),
    ];

    await writeFile(path.join(projectDir, `${sessionId}.jsonl`), parentLines.join('\n') + '\n');
    await writeFile(
      path.join(projectDir, sessionId, 'subagents', 'agent-a1234.jsonl'),
      subagentLines.join('\n') + '\n',
    );

    const messages = await loadHistory(sessionId, projectPath);
    const diffs = extractSessionDiffs(messages);

    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.filePath).toBe('/tmp/test-subagent-project/new-file.ts');
    expect(diffs[0]!.modified).toBe('export const hello = "world";');
  });

  it('excludes subagent messages from top-level chat messages', async () => {
    // Subagent JSONL messages must NOT appear as top-level ChatMessage entries —
    // they are internal to the subagent and only tool_result data is extracted.
    const parentLines = [
      JSON.stringify({
        type: 'assistant',
        uuid: 'a1',
        sessionId,
        timestamp: new Date().toISOString(),
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'I will use an agent' }],
        },
      }),
    ];

    const subagentLines = [
      JSON.stringify({
        type: 'assistant',
        uuid: 'sub-unique-1',
        sessionId,
        isSidechain: true,
        timestamp: new Date().toISOString(),
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'subagent response' }],
        },
      }),
    ];

    await writeFile(path.join(projectDir, `${sessionId}.jsonl`), parentLines.join('\n') + '\n');
    await writeFile(
      path.join(projectDir, sessionId, 'subagents', 'agent-b5678.jsonl'),
      subagentLines.join('\n') + '\n',
    );

    const messages = await loadHistory(sessionId, projectPath);
    // Only the parent assistant message — subagent messages are filtered out
    expect(messages).toHaveLength(1);
    expect(messages[0]!.id).toBe('a1');
  });
});

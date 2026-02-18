import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Stable base directory — vi.mock is hoisted so we can't use beforeEach vars.
const TEST_BASE = join(tmpdir(), 'mainframe-loadhistory-test');

vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>();
  return { ...original, homedir: () => TEST_BASE };
});

// Import after mock so the adapter picks up our homedir
import { ClaudeAdapter } from '../adapters/claude.js';

// ── JSONL fixture builder ──────────────────────────────────────────

function jsonlEntry(override: Record<string, unknown>) {
  return JSON.stringify({
    sessionId: 'test-session-abc',
    version: '2.1.37',
    timestamp: new Date().toISOString(),
    uuid: crypto.randomUUID(),
    ...override,
  });
}

function userTextEntry(text: string, extra?: Record<string, unknown>) {
  return jsonlEntry({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] },
    ...extra,
  });
}

function assistantTextEntry(text: string) {
  return jsonlEntry({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  });
}

function assistantToolUseEntry(toolName: string, input: Record<string, unknown>, toolUseId: string) {
  return jsonlEntry({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: `Using ${toolName}...` },
        { type: 'tool_use', id: toolUseId, name: toolName, input },
      ],
    },
  });
}

function toolResultEntry(toolUseId: string, content: string, isError = false) {
  return jsonlEntry({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError }],
    },
  });
}

function metaSkillEntry(skillPath: string) {
  return jsonlEntry({
    type: 'user',
    isMeta: true,
    message: {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Base directory for this skill: ${skillPath}\n\n# Skill Content\nThis is the skill content.`,
        },
      ],
    },
  });
}

function progressEntry() {
  return jsonlEntry({
    type: 'progress',
    data: { type: 'hook_progress', hookEvent: 'SessionStart' },
  });
}

function queueOperationEntry() {
  return jsonlEntry({ type: 'queue-operation', operation: 'dequeue' });
}

function resultEntry(subtype?: string, isError?: boolean) {
  return jsonlEntry({
    type: 'result',
    ...(subtype ? { subtype } : {}),
    ...(isError !== undefined ? { is_error: isError } : {}),
    cost_usd: 0.05,
    duration_ms: 12345,
  });
}

// ── Helpers ─────────────────────────────────────────────────────────

// loadHistory encodes projectPath: /tmp/test-project → -tmp-test-project
const PROJECT_PATH = '/tmp/test-project';
const ENCODED_PATH = PROJECT_PATH.replace(/[^a-zA-Z0-9-]/g, '-');
const PROJECT_DIR = join(TEST_BASE, '.claude', 'projects', ENCODED_PATH);
const SESSION_ID = 'test-session-abc';

function writeJsonl(sessionId: string, lines: string[]) {
  const filePath = join(PROJECT_DIR, `${sessionId}.jsonl`);
  writeFileSync(filePath, lines.join('\n') + '\n');
  return filePath;
}

// ── Tests ───────────────────────────────────────────────────────────

describe('ClaudeAdapter.loadHistory', () => {
  let adapter: ClaudeAdapter;

  beforeEach(() => {
    adapter = new ClaudeAdapter();
    mkdirSync(PROJECT_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true });
  });

  it('loads a simple user + assistant conversation', async () => {
    writeJsonl(SESSION_ID, [userTextEntry('Hello, world!'), assistantTextEntry('Hi there! How can I help?')]);

    const messages = await adapter.loadHistory(SESSION_ID, PROJECT_PATH);

    expect(messages).toHaveLength(2);
    expect(messages[0].type).toBe('user');
    expect(messages[0].content).toEqual([{ type: 'text', text: 'Hello, world!' }]);
    expect(messages[1].type).toBe('assistant');
    expect(messages[1].content).toEqual([{ type: 'text', text: 'Hi there! How can I help?' }]);
  });

  it('skips non-message entries (progress, queue-operation)', async () => {
    writeJsonl(SESSION_ID, [
      queueOperationEntry(),
      progressEntry(),
      progressEntry(),
      userTextEntry('Actual message'),
      assistantTextEntry('Response'),
    ]);

    const messages = await adapter.loadHistory(SESSION_ID, PROJECT_PATH);

    expect(messages).toHaveLength(2);
    expect(messages[0].type).toBe('user');
    expect(messages[1].type).toBe('assistant');
  });

  it('converts tool_use and tool_result entries', async () => {
    const toolUseId = 'toolu_abc123';
    writeJsonl(SESSION_ID, [
      userTextEntry('Write a file to /tmp/test.txt'),
      assistantToolUseEntry('Write', { file_path: '/tmp/test.txt', content: 'hello' }, toolUseId),
      toolResultEntry(toolUseId, 'File written successfully'),
      assistantTextEntry('Done! I wrote the file.'),
    ]);

    const messages = await adapter.loadHistory(SESSION_ID, PROJECT_PATH);

    expect(messages).toHaveLength(4);

    // User text
    expect(messages[0].type).toBe('user');

    // Assistant with tool_use
    expect(messages[1].type).toBe('assistant');
    expect(messages[1].content).toHaveLength(2);
    expect(messages[1].content[0]).toEqual({ type: 'text', text: 'Using Write...' });
    expect(messages[1].content[1]).toMatchObject({
      type: 'tool_use',
      id: toolUseId,
      name: 'Write',
    });

    // Tool result
    expect(messages[2].type).toBe('tool_result');
    expect(messages[2].content[0]).toMatchObject({
      type: 'tool_result',
      toolUseId,
      content: 'File written successfully',
      isError: false,
    });

    // Final assistant text
    expect(messages[3].type).toBe('assistant');
  });

  it('converts error result entries', async () => {
    writeJsonl(SESSION_ID, [
      userTextEntry('Do something'),
      assistantTextEntry('Working on it...'),
      resultEntry('error_during_execution'),
    ]);

    const messages = await adapter.loadHistory(SESSION_ID, PROJECT_PATH);

    expect(messages).toHaveLength(3);
    expect(messages[2].type).toBe('error');
    expect(messages[2].content[0]).toMatchObject({
      type: 'error',
      message: 'Session ended unexpectedly',
    });
  });

  it('skips non-error error_during_execution result entries', async () => {
    writeJsonl(SESSION_ID, [
      userTextEntry('Do something'),
      assistantTextEntry('Working on it...'),
      resultEntry('error_during_execution', false),
    ]);

    const messages = await adapter.loadHistory(SESSION_ID, PROJECT_PATH);

    expect(messages).toHaveLength(2);
    expect(messages[0].type).toBe('user');
    expect(messages[1].type).toBe('assistant');
  });

  it('skips normal result entries (non-error)', async () => {
    writeJsonl(SESSION_ID, [userTextEntry('Hello'), assistantTextEntry('Done'), resultEntry()]);

    const messages = await adapter.loadHistory(SESSION_ID, PROJECT_PATH);
    expect(messages).toHaveLength(2);
  });

  it('handles a realistic multi-turn session with tools', async () => {
    const toolId1 = 'toolu_write_1';
    const toolId2 = 'toolu_read_1';
    const toolId3 = 'toolu_exit_plan';

    writeJsonl(SESSION_ID, [
      // Non-message entries at the top (like real sessions)
      queueOperationEntry(),
      progressEntry(),
      progressEntry(),

      // Turn 1: user asks, assistant responds with text
      userTextEntry('generate a random plan to modify some file in /tmp'),
      assistantTextEntry('I understand. Let me create a plan to modify a temp file.'),

      // Turn 2: assistant uses Write tool
      assistantToolUseEntry('Write', { file_path: '/tmp/plan.md', content: '# Plan' }, toolId1),
      toolResultEntry(toolId1, 'File written successfully'),

      // Turn 3: assistant uses Read tool
      assistantToolUseEntry('Read', { file_path: '/tmp/plan.md' }, toolId2),
      toolResultEntry(toolId2, '# Plan\n1. Create file\n2. Modify file'),

      // Turn 4: assistant tries ExitPlanMode
      assistantToolUseEntry('ExitPlanMode', {}, toolId3),
      toolResultEntry(toolId3, 'Plan mode exited'),

      // Turn 5: final assistant response
      assistantTextEntry('The plan has been created and saved.'),
    ]);

    const messages = await adapter.loadHistory(SESSION_ID, PROJECT_PATH);

    // 3 non-message entries skipped → 9 messages
    expect(messages).toHaveLength(9);

    const types = messages.map((m) => m.type);
    expect(types).toEqual([
      'user',
      'assistant',
      'assistant',
      'tool_result',
      'assistant',
      'tool_result',
      'assistant',
      'tool_result',
      'assistant',
    ]);

    // All messages should have the correct chatId (sessionId used as chatId)
    for (const msg of messages) {
      expect(msg.chatId).toBe(SESSION_ID);
    }

    // All messages should have metadata.source === 'history'
    for (const msg of messages) {
      expect(msg.metadata?.source).toBe('history');
    }
  });

  it('filters slash-command invocation markers containing <command-name> tags', async () => {
    writeJsonl(SESSION_ID, [
      userTextEntry('<command-name>commit</command-name>\n/commit'),
      userTextEntry('You are a commit message generator. Analyze the staged changes...'),
      assistantTextEntry('Here is your commit message...'),
    ]);

    const messages = await adapter.loadHistory(SESSION_ID, PROJECT_PATH);

    // The command marker (first user message) is filtered; skill expansion content + assistant remain
    expect(messages).toHaveLength(2);
    expect(messages[0].type).toBe('user');
    expect(messages[1].type).toBe('assistant');
  });

  it('skips isMeta=true entries (skill content injections)', async () => {
    const toolUseId = 'toolu_skill_1';
    writeJsonl(SESSION_ID, [
      userTextEntry('Use the brainstorming skill'),
      assistantToolUseEntry('Skill', { skill: 'brainstorming' }, toolUseId),
      toolResultEntry(toolUseId, 'Launching skill: brainstorming'),
      metaSkillEntry('/home/user/.claude/skills/brainstorming'),
      assistantTextEntry('I am using the brainstorming skill to help you.'),
    ]);

    const messages = await adapter.loadHistory(SESSION_ID, PROJECT_PATH);

    // isMeta=true entry is skipped; 4 real messages remain
    expect(messages).toHaveLength(4);
    const types = messages.map((m) => m.type);
    expect(types).toEqual(['user', 'assistant', 'tool_result', 'assistant']);
  });

  it('preserves assistant turn continuity when isMeta entry is skipped', async () => {
    // Bug 1 regression: isMeta entries between two assistant entries were splitting
    // the consecutive assistant chain in groupMessages(), causing the first assistant
    // text to appear as a separate message from the announcement.
    const toolUseId = 'toolu_skill_2';
    writeJsonl(SESSION_ID, [
      userTextEntry('Let me start working on this'),
      assistantTextEntry('Let me start planning the restructure properly.'),
      assistantToolUseEntry('Skill', { skill: 'superpowers:brainstorming' }, toolUseId),
      toolResultEntry(toolUseId, 'Launching skill: superpowers:brainstorming'),
      metaSkillEntry('/home/user/.claude/skills/brainstorming'),
      assistantTextEntry('Using the brainstorming skill to design the website restructure properly.'),
    ]);

    const messages = await adapter.loadHistory(SESSION_ID, PROJECT_PATH);

    // isMeta entry is gone → 5 messages, no spurious user message splitting the assistant turns
    expect(messages).toHaveLength(5);
    const types = messages.map((m) => m.type);
    // user, assistant (pre-text), assistant (Skill tool_use), tool_result, assistant (announcement)
    expect(types).toEqual(['user', 'assistant', 'assistant', 'tool_result', 'assistant']);
    // No user or error message should appear at any point
    expect(types.filter((t) => t === 'user')).toHaveLength(1);
  });

  it('loads continuation files linked by sessionId', async () => {
    // Primary file
    writeJsonl(SESSION_ID, [userTextEntry('First message'), assistantTextEntry('First response')]);

    // Continuation file — first line's sessionId references the primary
    const continuationId = 'continuation-session-xyz';
    const contLines = [
      jsonlEntry({
        type: 'user',
        sessionId: SESSION_ID,
        message: { role: 'user', content: [{ type: 'text', text: 'Continued message' }] },
      }),
      jsonlEntry({
        type: 'assistant',
        sessionId: continuationId, // subsequent lines may have their own sessionId
        message: { role: 'assistant', content: [{ type: 'text', text: 'Continued response' }] },
      }),
    ];
    writeJsonl(continuationId, contLines);

    const messages = await adapter.loadHistory(SESSION_ID, PROJECT_PATH);

    expect(messages).toHaveLength(4);
    expect(messages[0].content[0]).toMatchObject({ text: 'First message' });
    expect(messages[2].content[0]).toMatchObject({ text: 'Continued message' });
    expect(messages[3].content[0]).toMatchObject({ text: 'Continued response' });
  });

  it('returns empty array for non-existent session', async () => {
    const messages = await adapter.loadHistory('nonexistent-session', PROJECT_PATH);
    expect(messages).toEqual([]);
  });

  it('skips malformed JSON lines', async () => {
    writeJsonl(SESSION_ID, [
      userTextEntry('Before bad line'),
      'this is not valid json {{{',
      '',
      assistantTextEntry('After bad line'),
    ]);

    const messages = await adapter.loadHistory(SESSION_ID, PROJECT_PATH);

    expect(messages).toHaveLength(2);
    expect(messages[0].type).toBe('user');
    expect(messages[1].type).toBe('assistant');
  });

  it('handles assistant entries with thinking blocks', async () => {
    writeJsonl(SESSION_ID, [
      userTextEntry('Solve this problem'),
      jsonlEntry({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Let me think about this...' },
            { type: 'text', text: 'Here is the solution.' },
          ],
        },
      }),
    ]);

    const messages = await adapter.loadHistory(SESSION_ID, PROJECT_PATH);

    expect(messages).toHaveLength(2);
    expect(messages[1].type).toBe('assistant');
    expect(messages[1].content).toHaveLength(2);
    expect(messages[1].content[0]).toMatchObject({ type: 'thinking', thinking: 'Let me think about this...' });
    expect(messages[1].content[1]).toMatchObject({ type: 'text', text: 'Here is the solution.' });
  });

  it('handles user entries with images', async () => {
    writeJsonl(SESSION_ID, [
      jsonlEntry({
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'What is in this image?' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
          ],
        },
      }),
      assistantTextEntry('I see a screenshot.'),
    ]);

    const messages = await adapter.loadHistory(SESSION_ID, PROJECT_PATH);

    expect(messages).toHaveLength(2);
    expect(messages[0].content).toHaveLength(2);
    expect(messages[0].content[0]).toMatchObject({ type: 'text', text: 'What is in this image?' });
    expect(messages[0].content[1]).toMatchObject({ type: 'image', mediaType: 'image/png', data: 'iVBORw0KGgo=' });
  });

  it('filters "[Request interrupted" text blocks', async () => {
    writeJsonl(SESSION_ID, [
      jsonlEntry({
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: '[Request interrupted by user]' },
            { type: 'tool_result', tool_use_id: 'toolu_123', content: 'aborted', is_error: true },
          ],
        },
      }),
      assistantTextEntry('Continuing...'),
    ]);

    const messages = await adapter.loadHistory(SESSION_ID, PROJECT_PATH);

    expect(messages).toHaveLength(2);
    // The "[Request interrupted" text should be stripped, leaving only tool_result
    expect(messages[0].type).toBe('tool_result');
    expect(messages[0].content).toHaveLength(1);
    expect(messages[0].content[0]).toMatchObject({ type: 'tool_result' });
  });

  it('skips user entries with empty array content', async () => {
    writeJsonl(SESSION_ID, [
      jsonlEntry({ type: 'user', message: { role: 'user', content: [] } }),
      assistantTextEntry('Response'),
    ]);

    const messages = await adapter.loadHistory(SESSION_ID, PROJECT_PATH);

    // Empty array content → 0 content blocks → entry skipped
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('assistant');
  });

  // TODO(task-support): update this test to assert TaskGroupCard rendering once task support is implemented
  it('skips user entries with task-notification string content (queue delivery messages)', async () => {
    writeJsonl(SESSION_ID, [
      userTextEntry('Run tasks in parallel'),
      assistantTextEntry('Launching tasks...'),
      jsonlEntry({
        type: 'user',
        message: {
          role: 'user',
          content:
            '<task-notification>\n<task-id>a671c39</task-id>\n<status>completed</status>\n<summary>Agent completed</summary>\n<result>Done.</result>\n</task-notification>\nFull transcript at: /tmp/tasks/a671c39.output',
        },
      }),
      assistantTextEntry('Tasks are done.'),
    ]);

    const messages = await adapter.loadHistory(SESSION_ID, PROJECT_PATH);

    // task-notification string entry is skipped; 3 real messages remain
    expect(messages).toHaveLength(3);
    const types = messages.map((m) => m.type);
    expect(types).toEqual(['user', 'assistant', 'assistant']);
  });

  it('converts system:compact_boundary to a visible "Context compacted" system message', async () => {
    writeJsonl(SESSION_ID, [
      userTextEntry('Do a lot of work'),
      assistantTextEntry('Working...'),
      jsonlEntry({
        type: 'system',
        subtype: 'compact_boundary',
        content: 'Conversation compacted',
        isMeta: false,
        compactMetadata: { trigger: 'auto', preTokens: 176418 },
      }),
      assistantTextEntry('Continuing from summary.'),
    ]);

    const messages = await adapter.loadHistory(SESSION_ID, PROJECT_PATH);

    expect(messages).toHaveLength(4);
    expect(messages[2].type).toBe('system');
    expect(messages[2].content[0]).toMatchObject({ type: 'text', text: 'Context compacted' });
  });

  it('skips isCompactSummary=true entries (context compaction messages)', async () => {
    writeJsonl(SESSION_ID, [
      userTextEntry('Hello'),
      assistantTextEntry('Hi!'),
      jsonlEntry({
        type: 'user',
        isCompactSummary: true,
        isVisibleInTranscriptOnly: true,
        message: {
          role: 'user',
          content:
            'This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\nSummary: ...',
        },
      }),
      assistantTextEntry('Continuing from where we left off.'),
    ]);

    const messages = await adapter.loadHistory(SESSION_ID, PROJECT_PATH);

    // compaction entry is skipped; 3 real messages remain
    expect(messages).toHaveLength(3);
    const types = messages.map((m) => m.type);
    expect(types).toEqual(['user', 'assistant', 'assistant']);
  });

  it('skips isVisibleInTranscriptOnly=true entries', async () => {
    writeJsonl(SESSION_ID, [
      userTextEntry('Hello'),
      jsonlEntry({
        type: 'user',
        isVisibleInTranscriptOnly: true,
        message: {
          role: 'user',
          content: 'Internal system message only for active session',
        },
      }),
      assistantTextEntry('Response'),
    ]);

    const messages = await adapter.loadHistory(SESSION_ID, PROJECT_PATH);

    expect(messages).toHaveLength(2);
    expect(messages[0].content[0]).toMatchObject({ text: 'Hello' });
    expect(messages[1].type).toBe('assistant');
  });

  it('keeps user entries with empty string content', async () => {
    writeJsonl(SESSION_ID, [
      jsonlEntry({ type: 'user', message: { role: 'user', content: '' } }),
      assistantTextEntry('Response'),
    ]);

    const messages = await adapter.loadHistory(SESSION_ID, PROJECT_PATH);

    // Empty string content → text block with empty string → not filtered
    expect(messages).toHaveLength(2);
    expect(messages[0].type).toBe('user');
    expect(messages[0].content[0]).toMatchObject({ type: 'text', text: '' });
  });

  it('handles tool_result with error flag', async () => {
    const toolUseId = 'toolu_err';
    writeJsonl(SESSION_ID, [
      userTextEntry('Run a dangerous command'),
      assistantToolUseEntry('Bash', { command: 'exit 1' }, toolUseId),
      toolResultEntry(toolUseId, 'Command failed with exit code 1', true),
      assistantTextEntry('The command failed.'),
    ]);

    const messages = await adapter.loadHistory(SESSION_ID, PROJECT_PATH);

    expect(messages).toHaveLength(4);
    expect(messages[2].content[0]).toMatchObject({
      type: 'tool_result',
      toolUseId,
      content: 'Command failed with exit code 1',
      isError: true,
    });
  });
});

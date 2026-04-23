import { describe, it, expect, vi } from 'vitest';
import { handleStdout, handleStderr } from '../plugins/builtin/claude/events.js';
import { ClaudeSession } from '../plugins/builtin/claude/session.js';
import type { SessionSink } from '@qlan-ro/mainframe-types';

function createSession(projectPath = '/tmp') {
  return new ClaudeSession({ projectPath, chatId: '' });
}

function createSink(): SessionSink {
  return {
    onInit: vi.fn(),
    onMessage: vi.fn(),
    onToolResult: vi.fn(),
    onPermission: vi.fn(),
    onResult: vi.fn(),
    onExit: vi.fn(),
    onError: vi.fn(),
    onCompact: vi.fn(),
    onCompactStart: vi.fn(),
    onContextUsage: vi.fn(),
    onPlanFile: vi.fn(),
    onSkillFile: vi.fn(),
    onQueuedProcessed: vi.fn(),
    onTodoUpdate: vi.fn(),
    onPrDetected: vi.fn(),
    onCliMessage: vi.fn(),
  };
}

describe('handleStdout', () => {
  it('parses complete JSON lines', () => {
    const session = createSession();
    const sink = createSink();

    const event = JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', model: 'claude', tools: [] });
    handleStdout(session, Buffer.from(event + '\n'), sink);

    expect(sink.onInit).toHaveBeenCalledWith('s1');
  });

  it('handles partial chunks by buffering', () => {
    const session = createSession();
    const sink = createSink();

    const event = JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', model: 'claude', tools: [] });
    const half1 = event.slice(0, 20);
    const half2 = event.slice(20) + '\n';

    handleStdout(session, Buffer.from(half1), sink);
    expect(sink.onInit).not.toHaveBeenCalled();

    handleStdout(session, Buffer.from(half2), sink);
    expect(sink.onInit).toHaveBeenCalledWith('s1');
  });

  it('skips non-JSON lines', () => {
    const session = createSession();
    const sink = createSink();

    handleStdout(session, Buffer.from('not json at all\n'), sink);
    expect(sink.onInit).not.toHaveBeenCalled();
    expect(sink.onMessage).not.toHaveBeenCalled();
  });

  it('skips empty lines', () => {
    const session = createSession();
    const sink = createSink();

    handleStdout(session, Buffer.from('\n\n\n'), sink);
    expect(sink.onInit).not.toHaveBeenCalled();
    expect(sink.onMessage).not.toHaveBeenCalled();
  });

  it('detects model-initiated skill from SkillTool tool_use and resolves path', async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const pathMod = await import('node:path');

    const projectDir = await mkdtemp(pathMod.join(tmpdir(), 'mf-skill-test-'));
    const skillDir = pathMod.join(projectDir, '.claude', 'skills', 'brainstorming');
    await mkdir(skillDir, { recursive: true });
    const skillPath = pathMod.join(skillDir, 'SKILL.md');
    await writeFile(skillPath, '# brainstorming');

    try {
      const session = createSession(projectDir);
      const sink = createSink();

      const event = JSON.stringify({
        type: 'assistant',
        message: {
          model: 'claude',
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'Skill', input: { skill: 'brainstorming' } }],
        },
      });
      handleStdout(session, Buffer.from(event + '\n'), sink);

      // Project-local skill file wins over user/plugin locations.
      expect(sink.onSkillFile).toHaveBeenCalledWith({ path: skillPath, displayName: 'brainstorming' });
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('falls back to ~/.claude/skills convention when the skill file is nowhere on disk', async () => {
    const { homedir } = await import('node:os');
    const pathMod = await import('node:path');

    const session = createSession();
    const sink = createSink();

    const event = JSON.stringify({
      type: 'assistant',
      message: {
        model: 'claude',
        content: [{ type: 'tool_use', id: 'toolu_2', name: 'Skill', input: { skill: '__definitely-not-installed' } }],
      },
    });
    handleStdout(session, Buffer.from(event + '\n'), sink);

    expect(sink.onSkillFile).toHaveBeenCalledWith({
      path: pathMod.join(homedir(), '.claude', 'skills', '__definitely-not-installed', 'SKILL.md'),
      displayName: '__definitely-not-installed',
    });
  });

  it('does NOT fire onSkillFile for user text blocks (prose or <skill-format> tags)', () => {
    const session = createSession();
    const sink = createSink();

    // User-event text must NOT be a skill signal — only assistant tool_use does.
    const event = JSON.stringify({
      type: 'user',
      isMeta: true,
      message: {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '<command-name>foo</command-name>\n<skill-format>true</skill-format>\n\nBase directory for this skill: /home/user/.claude/skills/foo',
          },
        ],
      },
    });
    handleStdout(session, Buffer.from(event + '\n'), sink);

    expect(sink.onSkillFile).not.toHaveBeenCalled();
  });

  // Fix B: CLI-synthesized user messages (e.g. unknown-command errors)
  it('surfaces CLI-synthesized text as onCliMessage when not isReplay and not isMeta', () => {
    const session = createSession();
    const sink = createSink();

    const event = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Unknown command: /inisights. Did you mean /insights?',
          },
        ],
      },
    });
    handleStdout(session, Buffer.from(event + '\n'), sink);

    expect(sink.onCliMessage).toHaveBeenCalledWith('Unknown command: /inisights. Did you mean /insights?');
  });

  it('skips onCliMessage when event isReplay is true', () => {
    const session = createSession();
    const sink = createSink();

    const event = JSON.stringify({
      type: 'user',
      isReplay: true,
      uuid: 'some-uuid',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'Hello from user' }],
      },
    });
    handleStdout(session, Buffer.from(event + '\n'), sink);

    expect(sink.onCliMessage).not.toHaveBeenCalled();
  });

  it('skips onCliMessage when event isMeta is true', () => {
    const session = createSession();
    const sink = createSink();

    const event = JSON.stringify({
      type: 'user',
      isMeta: true,
      message: {
        role: 'user',
        content: [{ type: 'text', text: '<local-command-caveat>skill content</local-command-caveat>' }],
      },
    });
    handleStdout(session, Buffer.from(event + '\n'), sink);

    expect(sink.onCliMessage).not.toHaveBeenCalled();
  });

  // Fix C: SkillTool detection in assistant events
  it('calls onSkillFile when a Skill tool_use block appears in assistant event', () => {
    const session = createSession();
    const sink = createSink();

    const event = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_001',
            name: 'Skill',
            input: { skill: 'brainstorming', args: 'some args' },
          },
        ],
      },
    });
    handleStdout(session, Buffer.from(event + '\n'), sink);

    expect(sink.onSkillFile).toHaveBeenCalledTimes(1);
    const call = (sink.onSkillFile as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.displayName).toBe('brainstorming');
    expect(call.path).toContain('brainstorming');
    expect(call.path).toContain('SKILL.md');
  });

  it('does not call onSkillFile when Skill tool_use has no skill name', () => {
    const session = createSession();
    const sink = createSink();

    const event = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_002', name: 'Skill', input: {} }],
      },
    });
    handleStdout(session, Buffer.from(event + '\n'), sink);

    expect(sink.onSkillFile).not.toHaveBeenCalled();
  });
});

describe('handleStderr', () => {
  it('emits error for non-informational messages', () => {
    const session = createSession();
    const sink = createSink();

    handleStderr(session, Buffer.from('Something went wrong\n'), sink);
    expect(sink.onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('filters informational patterns', () => {
    const session = createSession();
    const sink = createSink();

    handleStderr(session, Buffer.from('Warning: some deprecation\n'), sink);
    expect(sink.onError).not.toHaveBeenCalled();
  });

  it('ignores empty stderr', () => {
    const session = createSession();
    const sink = createSink();

    handleStderr(session, Buffer.from('   \n'), sink);
    expect(sink.onError).not.toHaveBeenCalled();
  });
});

import { describe, it, expect } from 'vitest';
import { getClaudeProjectDir, moveSessionFiles } from '../../workspace/session-files.js';
import { homedir } from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile, mkdir, readdir, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';

describe('getClaudeProjectDir', () => {
  it('encodes project path into claude projects directory', () => {
    const result = getClaudeProjectDir('/Users/foo/my-project');
    expect(result).toBe(path.join(homedir(), '.claude', 'projects', '-Users-foo-my-project'));
  });

  it('replaces non-alphanumeric characters except hyphens', () => {
    const result = getClaudeProjectDir('/tmp/test.dir/sub');
    expect(result).toBe(path.join(homedir(), '.claude', 'projects', '-tmp-test-dir-sub'));
  });
});

describe('moveSessionFiles', () => {
  const SESSION_ID = 'abc-123';

  async function setupSourceDir(): Promise<{ srcBase: string; tgtBase: string }> {
    const base = await mkdtemp(path.join(tmpdir(), 'session-files-'));
    const srcBase = path.join(base, 'source');
    const tgtBase = path.join(base, 'target');

    // Main JSONL
    await mkdir(srcBase, { recursive: true });
    await writeFile(path.join(srcBase, `${SESSION_ID}.jsonl`), '{"sessionId":"abc-123"}\n');

    // Session directory with subagents and tool-results
    await mkdir(path.join(srcBase, SESSION_ID, 'subagents'), { recursive: true });
    await writeFile(path.join(srcBase, SESSION_ID, 'subagents', 'agent-a1.jsonl'), 'subagent data');
    await writeFile(path.join(srcBase, SESSION_ID, 'subagents', 'agent-a1.meta.json'), '{}');
    await mkdir(path.join(srcBase, SESSION_ID, 'tool-results'), { recursive: true });
    await writeFile(path.join(srcBase, SESSION_ID, 'tool-results', 'toolu_01.txt'), 'tool output');

    // Sidechain JSONL (first line has matching sessionId)
    await writeFile(path.join(srcBase, `sidechain-999.jsonl`), `{"sessionId":"${SESSION_ID}"}\n`);

    // Unrelated JSONL (should NOT be moved)
    await writeFile(path.join(srcBase, 'other-session.jsonl'), '{"sessionId":"other"}\n');

    return { srcBase, tgtBase };
  }

  it('moves JSONL, session dir, and sidechain files to target', async () => {
    const { srcBase, tgtBase } = await setupSourceDir();

    await moveSessionFiles(SESSION_ID, srcBase, tgtBase);

    // Target has the files
    const tgtEntries = await readdir(tgtBase, { recursive: true });
    expect(tgtEntries).toContain(`${SESSION_ID}.jsonl`);
    expect(tgtEntries).toContain(SESSION_ID);
    expect(tgtEntries).toContain(`sidechain-999.jsonl`);

    // Content preserved
    const content = await readFile(path.join(tgtBase, SESSION_ID, 'subagents', 'agent-a1.jsonl'), 'utf-8');
    expect(content).toBe('subagent data');

    // Source files removed
    await expect(access(path.join(srcBase, `${SESSION_ID}.jsonl`))).rejects.toThrow();
    await expect(access(path.join(srcBase, SESSION_ID))).rejects.toThrow();
    await expect(access(path.join(srcBase, 'sidechain-999.jsonl'))).rejects.toThrow();

    // Unrelated file stays
    const otherContent = await readFile(path.join(srcBase, 'other-session.jsonl'), 'utf-8');
    expect(otherContent).toContain('other');
  });

  it('works when session directory does not exist', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'session-files-'));
    const srcBase = path.join(base, 'source');
    const tgtBase = path.join(base, 'target');

    await mkdir(srcBase, { recursive: true });
    await writeFile(path.join(srcBase, `${SESSION_ID}.jsonl`), '{"sessionId":"abc-123"}\n');

    await moveSessionFiles(SESSION_ID, srcBase, tgtBase);

    const content = await readFile(path.join(tgtBase, `${SESSION_ID}.jsonl`), 'utf-8');
    expect(content).toContain('abc-123');
  });
});

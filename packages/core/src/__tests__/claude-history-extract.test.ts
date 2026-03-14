import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extractModifiedFiles } from '../plugins/builtin/claude/history.js';

const PROJECT_PATH = '/Users/test/project';

function encodedProjectDir(): string {
  return PROJECT_PATH.replace(/[^a-zA-Z0-9-]/g, '-');
}

describe('extractModifiedFiles', () => {
  let tmpDir: string;
  let projectDir: string;
  let origHome: string;

  beforeEach(async () => {
    tmpDir = path.join(tmpdir(), `mf-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    projectDir = path.join(tmpDir, '.claude', 'projects', encodedProjectDir());
    await mkdir(projectDir, { recursive: true });
    origHome = process.env.HOME ?? '';
    process.env.HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.HOME = origHome;
    await rm(tmpDir, { recursive: true, force: true });
  });

  function writeJsonl(sessionId: string, entries: Record<string, unknown>[]): Promise<void> {
    const content = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
    return writeFile(path.join(projectDir, `${sessionId}.jsonl`), content);
  }

  it('extracts Write and Edit file paths from assistant events', async () => {
    await writeJsonl('session-1', [
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'tu-1', name: 'Write', input: { file_path: `${PROJECT_PATH}/src/main.ts` } },
          ],
        },
      },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'tu-2', name: 'Edit', input: { file_path: `${PROJECT_PATH}/lib/utils.ts` } },
          ],
        },
      },
    ]);

    const files = await extractModifiedFiles('session-1', PROJECT_PATH);
    expect(files).toContain('src/main.ts');
    expect(files).toContain('lib/utils.ts');
    expect(files).toHaveLength(2);
  });

  it('deduplicates files', async () => {
    await writeJsonl('session-2', [
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'tu-1', name: 'Write', input: { file_path: `${PROJECT_PATH}/src/main.ts` } },
          ],
        },
      },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'tu-2', name: 'Edit', input: { file_path: `${PROJECT_PATH}/src/main.ts` } },
          ],
        },
      },
    ]);

    const files = await extractModifiedFiles('session-2', PROJECT_PATH);
    expect(files).toEqual(['src/main.ts']);
  });

  it('ignores non-Write/Edit tools', async () => {
    await writeJsonl('session-3', [
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'ls' } }],
        },
      },
    ]);

    const files = await extractModifiedFiles('session-3', PROJECT_PATH);
    expect(files).toEqual([]);
  });

  it('ignores user events', async () => {
    await writeJsonl('session-4', [
      {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'ok' }],
        },
      },
    ]);

    const files = await extractModifiedFiles('session-4', PROJECT_PATH);
    expect(files).toEqual([]);
  });

  it('skips paths outside project', async () => {
    await writeJsonl('session-5', [
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'tu-1', name: 'Write', input: { file_path: '/etc/passwd' } }],
        },
      },
    ]);

    const files = await extractModifiedFiles('session-5', PROJECT_PATH);
    expect(files).toEqual([]);
  });

  it('returns empty for nonexistent JSONL', async () => {
    const files = await extractModifiedFiles('nonexistent', PROJECT_PATH);
    expect(files).toEqual([]);
  });

  it('handles relative paths directly', async () => {
    await writeJsonl('session-6', [
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'tu-1', name: 'Write', input: { file_path: 'src/relative.ts' } }],
        },
      },
    ]);

    const files = await extractModifiedFiles('session-6', PROJECT_PATH);
    expect(files).toEqual(['src/relative.ts']);
  });
});

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isClaudeTranscriptPresent } from '../transcript.js';

describe('isClaudeTranscriptPresent', () => {
  let dir: string;
  let existingJsonl: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'mf-claude-transcript-'));
    existingJsonl = path.join(dir, 'session-1.jsonl');
    await writeFile(existingJsonl, '{"type":"user"}\n');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns true when the stored sessionFilePath exists', async () => {
    await expect(isClaudeTranscriptPresent('session-1', '/nonexistent/project', existingJsonl)).resolves.toBe(true);
  });

  it('returns false when neither the stored path nor the derived path exists', async () => {
    await expect(
      isClaudeTranscriptPresent('no-such-session', '/nonexistent/project', path.join(dir, 'gone.jsonl')),
    ).resolves.toBe(false);
  });

  it('returns false when no stored path is given and the derived path does not exist', async () => {
    await expect(isClaudeTranscriptPresent('no-such-session', '/nonexistent/project')).resolves.toBe(false);
  });
});

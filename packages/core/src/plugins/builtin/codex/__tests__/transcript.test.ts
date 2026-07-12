import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isCodexTranscriptPresent } from '../transcript.js';
import type { AgentMetadata } from '../thread-registry.js';

const THREAD_ID = 'thread-abc';

function lookupWith(rolloutPath: string | null): (ids: readonly string[]) => Map<string, AgentMetadata> {
  return () => new Map([[THREAD_ID, { nickname: null, role: null, rolloutPath }]]);
}

describe('isCodexTranscriptPresent', () => {
  let sessionsRoot: string;
  let rolloutFile: string;

  beforeAll(async () => {
    sessionsRoot = await mkdtemp(path.join(tmpdir(), 'mf-codex-sessions-'));
    const dayDir = path.join(sessionsRoot, '2026', '07', '08');
    await mkdir(dayDir, { recursive: true });
    rolloutFile = path.join(dayDir, `rollout-2026-07-08-${THREAD_ID}.jsonl`);
    await writeFile(rolloutFile, '{"type":"response_item"}\n');
  });

  afterAll(async () => {
    await rm(sessionsRoot, { recursive: true, force: true });
  });

  it('returns true when the registry rollout file exists inside the sessions root', async () => {
    await expect(isCodexTranscriptPresent(THREAD_ID, { lookup: lookupWith(rolloutFile), sessionsRoot })).resolves.toBe(
      true,
    );
  });

  it('returns false when the rollout file was deleted', async () => {
    const gone = path.join(sessionsRoot, '2026', '07', '08', `rollout-gone-${THREAD_ID}.jsonl`);
    await expect(isCodexTranscriptPresent(THREAD_ID, { lookup: lookupWith(gone), sessionsRoot })).resolves.toBe(false);
  });

  it('returns null when the registry has no row for the thread (cannot determine)', async () => {
    await expect(isCodexTranscriptPresent(THREAD_ID, { lookup: () => new Map(), sessionsRoot })).resolves.toBeNull();
  });

  it('returns null when the registry row has no rollout path', async () => {
    await expect(isCodexTranscriptPresent(THREAD_ID, { lookup: lookupWith(null), sessionsRoot })).resolves.toBeNull();
  });

  it('returns null when the rollout path resolves outside the sessions root (untrusted)', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'mf-codex-outside-'));
    const outsideFile = path.join(outside, 'rollout-x.jsonl');
    await writeFile(outsideFile, 'x\n');
    await expect(
      isCodexTranscriptPresent(THREAD_ID, { lookup: lookupWith(outsideFile), sessionsRoot }),
    ).resolves.toBeNull();
    await rm(outside, { recursive: true, force: true });
  });
});

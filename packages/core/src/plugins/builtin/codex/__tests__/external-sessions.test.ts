import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, utimes, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listExternalSessions, clearCodexExternalSessionCache } from '../external-sessions.js';

interface RolloutSpec {
  id: string;
  cwd: string;
  branch?: string;
  createdAt?: string;
  /** User-message texts, in order (one input_text block each). */
  userMessages?: string[];
  /** User messages with multiple input_text blocks each (mirrors Codex's bundled first message). */
  userBlockMessages?: string[][];
  /** Extra malformed/truncated lines appended verbatim. */
  rawTrailing?: string[];
  mtime?: Date;
}

async function writeRollout(root: string, spec: RolloutSpec): Promise<string> {
  const dir = join(root, '2026', '05', '01');
  await mkdir(dir, { recursive: true });
  const ts = spec.createdAt ?? '2026-05-01T02:00:47.000Z';
  const meta = {
    timestamp: ts,
    type: 'session_meta',
    payload: {
      id: spec.id,
      timestamp: ts,
      cwd: spec.cwd,
      originator: 'mainframe',
      ...(spec.branch ? { git: { branch: spec.branch } } : {}),
    },
  };
  const lines = [JSON.stringify(meta)];
  const messages: string[][] = [...(spec.userBlockMessages ?? []), ...(spec.userMessages ?? []).map((text) => [text])];
  for (const blocks of messages) {
    lines.push(
      JSON.stringify({
        timestamp: ts,
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: blocks.map((text) => ({ type: 'input_text', text })),
        },
      }),
    );
  }
  for (const raw of spec.rawTrailing ?? []) lines.push(raw);

  const filePath = join(dir, `rollout-2026-05-01T02-00-47-${spec.id}.jsonl`);
  await writeFile(filePath, lines.join('\n') + '\n', 'utf8');
  if (spec.mtime) await utimes(filePath, spec.mtime, spec.mtime);
  return filePath;
}

const PROJECT = '/Users/dev/projects/app';
const uuid = (n: number) => `019de09f-93b4-7832-b2aa-c6b3dae2${n.toString().padStart(4, '0')}`;

describe('codex listExternalSessions (rollout scan)', () => {
  let root: string;
  beforeEach(async () => {
    clearCodexExternalSessionCache();
    root = await mkdtemp(join(tmpdir(), 'codex-rollouts-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('includes sessions whose meta cwd matches the project (equal or nested), excludes others', async () => {
    await writeRollout(root, { id: uuid(1), cwd: PROJECT, userMessages: ['Fix the login bug'] });
    await writeRollout(root, { id: uuid(2), cwd: join(PROJECT, 'packages/ui'), userMessages: ['Nested worktree'] });
    await writeRollout(root, { id: uuid(3), cwd: '/Users/dev/projects/other', userMessages: ['Different project'] });

    const page = await listExternalSessions(PROJECT, [], undefined, { sessionsRoot: root });

    const ids = page.sessions.map((s) => s.sessionId).sort();
    expect(ids).toEqual([uuid(1), uuid(2)]);
    expect(page.total).toBe(2);
    expect(page.sessions.every((s) => s.adapterId === 'codex')).toBe(true);
  });

  it('derives firstPrompt from the first non-preamble user message', async () => {
    await writeRollout(root, {
      id: uuid(1),
      cwd: PROJECT,
      userMessages: [
        '<environment_context>\n  <cwd>/x</cwd>\n</environment_context>',
        '# AGENTS.md instructions for /Users/dev/projects/app\n<INSTRUCTIONS>do things</INSTRUCTIONS>',
        '<image name=[Image #1]></image>Add a dark mode toggle to settings',
      ],
    });

    const page = await listExternalSessions(PROJECT, [], undefined, { sessionsRoot: root });

    expect(page.sessions).toHaveLength(1);
    expect(page.sessions[0]!.firstPrompt).toBe('Add a dark mode toggle to settings');
    expect(page.sessions[0]!.title).toBe('Add a dark mode toggle to settings');
  });

  it('skips every injected block of the bundled first message, then finds the real prompt', async () => {
    await writeRollout(root, {
      id: uuid(1),
      cwd: PROJECT,
      userBlockMessages: [
        [
          '<recommended_plugins>\nplugins here\n</recommended_plugins>',
          '# AGENTS.md instructions for /app\n<INSTRUCTIONS>x</INSTRUCTIONS>',
          '<environment_context>\n<cwd>/app</cwd>\n</environment_context>',
        ],
      ],
      userMessages: ['Wire up the settings page'],
    });

    const page = await listExternalSessions(PROJECT, [], undefined, { sessionsRoot: root });
    expect(page.sessions[0]!.firstPrompt).toBe('Wire up the settings page');
  });

  it('falls back to a synthetic title when only preamble messages exist', async () => {
    await writeRollout(root, {
      id: uuid(1),
      cwd: PROJECT,
      userMessages: ['<environment_context>\n  <cwd>/x</cwd>\n</environment_context>'],
    });

    const page = await listExternalSessions(PROJECT, [], undefined, { sessionsRoot: root });
    expect(page.sessions[0]!.firstPrompt).toBeUndefined();
    expect(page.sessions[0]!.title).toBe('(session)');
  });

  it('excludes already-imported session ids', async () => {
    await writeRollout(root, { id: uuid(1), cwd: PROJECT, userMessages: ['one'] });
    await writeRollout(root, { id: uuid(2), cwd: PROJECT, userMessages: ['two'] });

    const page = await listExternalSessions(PROJECT, [uuid(1)], undefined, { sessionsRoot: root });
    expect(page.sessions.map((s) => s.sessionId)).toEqual([uuid(2)]);
    expect(page.total).toBe(1);
  });

  it('sorts by modification time descending', async () => {
    await writeRollout(root, {
      id: uuid(1),
      cwd: PROJECT,
      userMessages: ['old'],
      mtime: new Date('2026-05-01T00:00:00Z'),
    });
    await writeRollout(root, {
      id: uuid(2),
      cwd: PROJECT,
      userMessages: ['new'],
      mtime: new Date('2026-05-02T00:00:00Z'),
    });

    const page = await listExternalSessions(PROJECT, [], undefined, { sessionsRoot: root });
    expect(page.sessions.map((s) => s.sessionId)).toEqual([uuid(2), uuid(1)]);
  });

  it('paginates with total and nextOffset', async () => {
    for (let i = 1; i <= 3; i++) {
      await writeRollout(root, {
        id: uuid(i),
        cwd: PROJECT,
        userMessages: [`msg ${i}`],
        mtime: new Date(`2026-05-0${i}T00:00:00Z`),
      });
    }

    const page = await listExternalSessions(PROJECT, [], { offset: 0, limit: 2 }, { sessionsRoot: root });
    expect(page.total).toBe(3);
    expect(page.sessions).toHaveLength(2);
    expect(page.nextOffset).toBe(2);

    const page2 = await listExternalSessions(PROJECT, [], { offset: 2, limit: 2 }, { sessionsRoot: root });
    expect(page2.sessions).toHaveLength(1);
    expect(page2.nextOffset).toBeNull();
  });

  it('count-only (limit<=0) returns total without enriched sessions', async () => {
    await writeRollout(root, { id: uuid(1), cwd: PROJECT, userMessages: ['a'] });
    await writeRollout(root, { id: uuid(2), cwd: PROJECT, userMessages: ['b'] });

    const page = await listExternalSessions(PROJECT, [], { offset: 0, limit: 0 }, { sessionsRoot: root });
    expect(page.total).toBe(2);
    expect(page.sessions).toEqual([]);
    expect(page.nextOffset).toBeNull();
  });

  it('captures the git branch from meta', async () => {
    await writeRollout(root, { id: uuid(1), cwd: PROJECT, branch: 'feat/x', userMessages: ['hi'] });
    const page = await listExternalSessions(PROJECT, [], undefined, { sessionsRoot: root });
    expect(page.sessions[0]!.gitBranch).toBe('feat/x');
  });

  it('tolerates malformed/truncated lines without crashing', async () => {
    await writeRollout(root, {
      id: uuid(1),
      cwd: PROJECT,
      userMessages: ['valid prompt'],
      rawTrailing: ['{ this is not json', '{"type":"response_item","payload":'],
    });
    const page = await listExternalSessions(PROJECT, [], undefined, { sessionsRoot: root });
    expect(page.sessions).toHaveLength(1);
    expect(page.sessions[0]!.firstPrompt).toBe('valid prompt');
  });

  it('returns an empty page when the sessions root does not exist', async () => {
    const page = await listExternalSessions(PROJECT, [], undefined, { sessionsRoot: join(root, 'nope') });
    expect(page).toEqual({ sessions: [], total: 0, nextOffset: null });
  });
});

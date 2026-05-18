import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readToolResultFromJsonl } from '../read-tool-result-from-jsonl.js';

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'jsonl-'));
  const file = join(dir, 's.jsonl');
  const lines = [
    JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'FULL CONTENT ONE' }] },
    }),
    JSON.stringify({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_2',
            content: [
              { type: 'text', text: 'PART A' },
              { type: 'text', text: 'PART B' },
            ],
          },
        ],
      },
    }),
  ];
  writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

describe('readToolResultFromJsonl', () => {
  it('returns full string content by tool_use id', async () => {
    expect(await readToolResultFromJsonl(fixture(), 'tu_1')).toBe('FULL CONTENT ONE');
  });
  it('flattens array content blocks to a string', async () => {
    const r = await readToolResultFromJsonl(fixture(), 'tu_2');
    expect(r).toContain('PART A');
    expect(r).toContain('PART B');
  });
  it('returns null when the id is absent', async () => {
    expect(await readToolResultFromJsonl(fixture(), 'nope')).toBeNull();
  });
  it('returns null when the file does not exist', async () => {
    expect(await readToolResultFromJsonl('/no/such/file.jsonl', 'tu_1')).toBeNull();
  });
  it('tolerates a partial trailing line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jsonl-'));
    const file = join(dir, 's.jsonl');
    writeFileSync(
      file,
      JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'tu_9', content: 'OK' }] },
      }) + '\n{"type":"user","mess',
    );
    expect(await readToolResultFromJsonl(file, 'tu_9')).toBe('OK');
  });
});

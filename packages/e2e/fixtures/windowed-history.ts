import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const WINDOWED_RECORDING_KEY = 'windowed-history';
export const WINDOWED_TURNS = 250;

export function writeWindowedHistoryRecording(
  directory = mkdtempSync(path.join(tmpdir(), 'mf-windowed-recording-')),
): string {
  const events: object[] = [];
  const add = (dir: 'in' | 'out', method: string, args: unknown[]) => events.push({ dir, method, args, delayMs: 0 });
  add('in', 'sendMessage', ['Fixture setup']);
  add('out', 'onInit', ['windowed-reference-session']);
  add('out', 'onResult', [{ subtype: 'success', is_error: false }]);
  const result = `hidden-output-token\n${'x'.repeat(32768)}`;
  for (let turn = 0; turn < WINDOWED_TURNS; turn++) {
    add('in', 'sendMessage', [`Needle turn ${turn}${turn === 2 ? ' ancient landmark' : ''}`]);
    const content: object[] = [{ type: 'text', text: `History response ${turn}` }];
    const results: object[] = [];
    for (let tool = 0; tool < 4; tool++) {
      const id = `window-tool-${turn}-${tool}`;
      content.push({ type: 'tool_use', id, name: 'Read', input: { file_path: `/fixture/file-${tool}.txt` } });
      content.push({ type: 'text', text: `Tool summary ${turn}/${tool}` });
      results.push({ type: 'tool_result', toolUseId: id, content: result, isError: false });
    }
    add('out', 'onMessage', [content]);
    add('out', 'onToolResult', [results]);
    add('out', 'onResult', [{ subtype: 'success', is_error: false }]);
  }
  const recording = events.map((event) => JSON.stringify(event)).join('\n') + '\n';
  for (const coldReader of [0, 1, 2])
    writeFileSync(path.join(directory, `${WINDOWED_RECORDING_KEY}.${coldReader}.ndjson`), recording);
  return directory;
}

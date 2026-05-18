import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { extractToolResultContent } from '../plugins/builtin/claude/history.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('jsonl-tool-result');

export async function readToolResultFromJsonl(filePath: string, toolUseId: string): Promise<string | null> {
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      let row: unknown;
      try {
        row = JSON.parse(line);
      } catch {
        /* expected: tolerate a partially-written trailing line */
        continue;
      }
      const content = (row as { message?: { content?: unknown } })?.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (
          block &&
          typeof block === 'object' &&
          (block as { type?: string }).type === 'tool_result' &&
          (block as { tool_use_id?: string }).tool_use_id === toolUseId
        ) {
          return extractToolResultContent((block as { content?: unknown }).content);
        }
      }
    }
  } catch (err) {
    log.warn({ err: String(err), filePath }, 'error scanning session jsonl');
    return null;
  } finally {
    rl.close();
  }
  return null;
}

/**
 * `shape=heavy`: a large Claude chat with no real content. Every turn is one prompt and `per` assistant
 * messages of one tool call each (a Claude turn sends one message per model response), ending in an answer with a heading, prose, a code block and a table.
 * Finished turns fold, so each draws its header, its answer and `per - 2` empty 1 px rows (`TurnSlice.tsx`). The
 * window holds the newest ten turns: about 1,500 rows of 1 px at the default `per` of 150.
 */
import type { ThreadMessage } from '@assistant-ui/react';
import { answerText, assistant, prose, tool, userMessage, type Transcript } from './fixture';

const TOOLS = ['Read', 'Bash', 'Grep', 'Edit'] as const;

function heavyTurn(t: number, per: number): ThreadMessage[] {
  const at = t * 10;
  const messages: ThreadMessage[] = [userMessage(`h${t}-u`, at, `Request ${t}: ${prose(1)}`)];
  for (let k = 0; k < per - 1; k++) {
    const name = TOOLS[k % TOOLS.length]!;
    messages.push(
      assistant(`h${t}-a${k}`, at + 1, [
        { type: 'reasoning', text: 'Checking the next file.' },
        tool(`h${t}-tool${k}`, name, { file_path: `/workspace/src/f${k}.ts`, command: `pnpm test f${k}` }, `ok ${k}\n`),
      ]),
    );
  }
  messages.push(assistant(`h${t}-answer`, at + 2, [{ type: 'text', text: answerText(t) }]));
  return messages;
}

export function buildHeavyTranscript(turns: number, windowTurns: number, per: number): Transcript {
  const all = Array.from({ length: turns }, (_, t) => heavyTurn(t, per)).flat();
  return { all, windowStart: all.findIndex((m) => m.id === `h${turns - windowTurns}-u`) };
}

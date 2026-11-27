/**
 * `shape=real`: the measured shape of the first window of a real tool-heavy chat, with no real
 * content. A unit is 80 items in 8 containers, oldest first: user, user, a turn of 33 tool calls,
 * 5 texts and 2 thoughts, user, user, user, a turn of 24 tool calls, 5 texts and 5 thoughts. Both
 * turns finish folded, so a unit shows about ten rows and is about one viewport tall. The chat is
 * twelve units; the window is the newest unit and each older page (80 items) is one more.
 */
import type { ThreadAssistantMessagePart, ThreadMessage } from '@assistant-ui/react';
import { assistant, prose, tool, userMessage, type Transcript } from './fixture';

const TOOLS = ['Read', 'Bash', 'Grep', 'Edit'] as const;

function toolPart(id: string, n: number) {
  const name = TOOLS[n % TOOLS.length]!;
  if (name === 'Read')
    return tool(id, name, { file_path: `/workspace/src/file-${n}.ts` }, `export const v${n} = ${n};\n`.repeat(8));
  if (name === 'Bash') return tool(id, name, { command: `pnpm test file-${n}` }, `PASS file-${n}\n`.repeat(4));
  if (name === 'Grep') return tool(id, name, { pattern: `v${n}`, path: '/workspace/src' }, `src/a.ts:${n}\n`.repeat(4));
  return tool(
    id,
    name,
    { file_path: `/workspace/src/file-${n}.ts`, old_string: 'a', new_string: 'b' },
    'The file was updated.',
  );
}

/** A turn's assistant messages: tools, texts and thoughts dealt round-robin over five messages, a text last. */
function turn(id: string, index: number, tools: number, texts: number, thoughts: number): ThreadMessage[] {
  const parts: ThreadAssistantMessagePart[][] = Array.from({ length: 5 }, () => []);
  for (let i = 0; i < thoughts; i++) parts[i % 5]!.push({ type: 'reasoning', text: prose(1) });
  for (let i = 0; i < tools; i++) parts[i % 5]!.push(toolPart(`${id}-tool${i}`, i));
  for (let i = 0; i < texts - 1; i++) parts[i % 5]!.push({ type: 'text', text: `${prose(1)}` });
  parts[4]!.push({ type: 'text', text: `Done. ${prose(2)}` });
  return parts.map((content, k) => assistant(`${id}-a${k}`, index + k, content));
}

function unit(u: number): ThreadMessage[] {
  const at = u * 10;
  const user = (k: number) => userMessage(`r${u}-u${k}`, at + k, `Request ${u}.${k}: ${prose(1)}`);
  return [
    user(0),
    user(1),
    ...turn(`r${u}-A`, at + 2, 33, 5, 2),
    user(2),
    user(3),
    user(4),
    ...turn(`r${u}-B`, at + 5, 24, 5, 5),
  ];
}

export function buildRealTranscript(units = 12): Transcript {
  const all = Array.from({ length: units }, (_, u) => unit(u)).flat();
  return { all, windowStart: all.findIndex((m) => m.id === `r${units - 1}-u0`) };
}

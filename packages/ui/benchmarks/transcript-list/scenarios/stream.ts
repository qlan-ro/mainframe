/** A run that streams: 30 chunks a second into the newest text, a new row every 250 ms. */
import type { ThreadAssistantMessagePart, ThreadMessage } from '@assistant-ui/react';
import { sleep, viewport } from '../probe';
import { store } from '../store';
import { commits } from '../commits';

const CHUNK = 'streamed words arrive in small pieces while the agent works ';

function assistantMessage(id: string, content: ThreadMessage['content']): ThreadMessage {
  return {
    id,
    role: 'assistant',
    createdAt: new Date(),
    content,
    status: { type: 'running' },
    metadata: { unstable_state: null, unstable_annotations: [], unstable_data: [], steps: [], custom: {} },
  } as ThreadMessage;
}

function toolRow(id: string): ThreadAssistantMessagePart {
  return {
    type: 'tool-call',
    toolCallId: id,
    toolName: 'Bash',
    args: { command: `pnpm test ${id}` },
    argsText: '{}',
    result: 'PASS\n'.repeat(4),
    providerMetadata: { mainframe: { acpStatus: 'completed' } },
  } as ThreadAssistantMessagePart;
}

export interface StreamStats {
  commits: number[];
  /** `commits.length` at each chunk write, to sum React render time per chunk. */
  marks?: number[];
}

/** React render time spent between one chunk write and the next. */
export function renderPerChunk(stats: StreamStats) {
  const marks = stats.marks ?? [];
  return marks.slice(0, -1).map((at, i) => commits.slice(at, marks[i + 1]).reduce((a, b) => a + b, 0));
}

/** Measures each chunk from the store write to the first DOM mutation it causes (the commit). */
function timedWrite(stats: StreamStats, write: () => void) {
  const el = viewport();
  stats.marks?.push(commits.length);
  const start = performance.now();
  const observer = new MutationObserver(() => {
    stats.commits.push(performance.now() - start);
    observer.disconnect();
  });
  observer.observe(el, { childList: true, subtree: true, characterData: true });
  write();
  setTimeout(() => observer.disconnect(), 100);
}

export function startStream(stats: StreamStats) {
  let rows = 0;
  let current = `live-a0`;
  let text = '';
  store.sendUser(0, 'Run the checks again and report.');
  store.set({ messages: [...store.get().messages, assistantMessage(current, [{ type: 'text', text: '' }])] });
  const chunk = setInterval(() => {
    text += CHUNK;
    const id = current;
    timedWrite(stats, () => store.replace(id, (m) => ({ ...m, content: [{ type: 'text', text }] })));
  }, 1000 / 30);
  const row = setInterval(() => {
    rows++;
    text = '';
    current = `live-a${rows}`;
    const next = [
      assistantMessage(`live-t${rows}`, [toolRow(`live-tool-${rows}`)]),
      assistantMessage(current, [{ type: 'text', text: '' }]),
    ];
    store.set({ messages: [...store.get().messages, ...next] });
  }, 250);
  return async function stop() {
    clearInterval(chunk);
    clearInterval(row);
    await sleep(50);
    const done = store
      .get()
      .messages.map((m) =>
        m.status?.type === 'running' ? ({ ...m, status: { type: 'complete', reason: 'stop' } } as ThreadMessage) : m,
      );
    store.set({ messages: done, running: false });
  };
}

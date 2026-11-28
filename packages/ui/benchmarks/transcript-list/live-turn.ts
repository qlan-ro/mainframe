/**
 * A live turn shaped like a Claude reply, with no real content: each step is one assistant message whose
 * thinking streams, then (sometimes) a sentence, then a tool call that runs for a while and completes. The
 * tools come in runs of reads and searches long enough to fold into an "Explored" step once something
 * follows them, between Bash calls and edits. The last message is a long streamed answer. `end()` finishes
 * the run, and the turn folds. Thirty writes a second, as `scenarios/stream.ts` streams.
 */
import type { ThreadAssistantMessagePart, ThreadMessage } from '@assistant-ui/react';
import { answerText, prose } from './fixture';
import { store } from './store';

const TOOLS = ['Read', 'Read', 'Grep', 'Read', 'Read', 'Bash', 'Edit', 'Read', 'Grep', 'Read', 'Read', 'Read', 'Bash'];
const TICK_MS = 1000 / 30;

function message(id: string, content: ThreadAssistantMessagePart[], running: boolean): ThreadMessage {
  return {
    id,
    role: 'assistant',
    createdAt: new Date(),
    content,
    status: running ? { type: 'running' } : { type: 'complete', reason: 'stop' },
    metadata: { unstable_state: null, unstable_annotations: [], unstable_data: [], steps: [], custom: {} },
  } as ThreadMessage;
}

function toolCall(id: string, name: string, n: number, done: boolean): ThreadAssistantMessagePart {
  const args: Record<string, string> =
    name === 'Bash'
      ? { command: `pnpm test live-${n}` }
      : name === 'Grep'
        ? { pattern: `live${n}`, path: '/workspace/src' }
        : name === 'Edit'
          ? { file_path: `/workspace/src/live-${n}.ts`, old_string: 'a', new_string: 'b' }
          : { file_path: `/workspace/src/live-${n}.ts` };
  const result =
    name === 'Bash'
      ? `PASS live-${n}\n`.repeat(6)
      : name === 'Edit'
        ? 'The file was updated.'
        : `line ${n}\n`.repeat(12);
  return {
    type: 'tool-call',
    toolCallId: id,
    toolName: name,
    args,
    argsText: JSON.stringify(args),
    ...(done ? { result } : {}),
    providerMetadata: { mainframe: { acpStatus: done ? 'completed' : 'in_progress' } },
  } as ThreadAssistantMessagePart;
}

interface Phase {
  /** Ticks this phase lasts. */
  ticks: number;
  content: (tick: number) => ThreadAssistantMessagePart[];
}

/** One step's phases: think, maybe say something, run a tool. */
function stepPhases(n: number, tag: string): Phase[] {
  const name = TOOLS[n % TOOLS.length]!;
  const thought = prose(2);
  const said = n % 3 === 0 ? `Next I will look at part ${n}. ${prose(1)}` : '';
  const toolId = `${tag}-tool-${n}`;
  const think = (tick: number, of: number) => ({
    type: 'reasoning' as const,
    text: thought.slice(0, Math.ceil((thought.length * tick) / of)),
  });
  const phases: Phase[] = [{ ticks: 8, content: (tick) => [think(tick + 1, 8)] }];
  if (said)
    phases.push({
      ticks: 10,
      content: (tick) => [
        think(8, 8),
        { type: 'text', text: said.slice(0, Math.ceil((said.length * (tick + 1)) / 10)) },
      ],
    });
  const before = (): ThreadAssistantMessagePart[] => [
    think(8, 8),
    ...(said ? [{ type: 'text' as const, text: said }] : []),
  ];
  phases.push({ ticks: name === 'Bash' ? 18 : 6, content: () => [...before(), toolCall(toolId, name, n, false)] });
  phases.push({ ticks: 1, content: () => [...before(), toolCall(toolId, name, n, true)] });
  return phases;
}

export interface LiveTurn {
  /** Steps written so far. */
  steps: () => number;
  /** Ends the run: every message completes and `running` goes false, so the turn folds. */
  end: () => Promise<void>;
  /** Stops writing without ending the run. */
  pause: () => void;
}

export function startLiveTurn({
  steps = 40,
  prompt = 'Find out why the build fails and fix it.',
  send = true,
  tag = 'lv',
  forceLayout = false,
} = {}): LiveTurn {
  if (send) store.sendUser(Date.now() % 100000, prompt);
  let n = 0;
  let phases = stepPhases(0, tag);
  let phase = 0;
  let tick = 0;
  let answer = '';
  const full = answerText(9000);
  const id = (k: number) => `${tag}-a${k}`;
  const write = (content: ThreadAssistantMessagePart[]) => {
    const messages = store.get().messages;
    const at = messages.findIndex((m) => m.id === id(n));
    const next = message(id(n), content, true);
    store.set({ messages: at < 0 ? [...messages, next] : messages.map((m, i) => (i === at ? next : m)) });
    // Something else on the page reads layout after React commits, in the same task (a panel measuring a row,
    // an editor reading its caret): the browser lays out, and anchors, between frames.
    if (forceLayout) queueMicrotask(() => queueMicrotask(() => void document.body.offsetHeight));
  };
  const timer = setInterval(() => {
    if (n >= steps) {
      answer = full.slice(0, answer.length + 24);
      write([{ type: 'text', text: answer }]);
      return;
    }
    const current = phases[phase]!;
    write(current.content(tick));
    tick++;
    if (tick < current.ticks) return;
    tick = 0;
    phase++;
    if (phase < phases.length) return;
    phase = 0;
    n++;
    phases = stepPhases(n, tag);
  }, TICK_MS);
  return {
    steps: () => n,
    pause: () => clearInterval(timer),
    async end() {
      clearInterval(timer);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const done = store
        .get()
        .messages.map((m) =>
          m.status?.type === 'running' ? ({ ...m, status: { type: 'complete', reason: 'stop' } } as ThreadMessage) : m,
        );
      store.set({ messages: done, running: false });
    },
  };
}

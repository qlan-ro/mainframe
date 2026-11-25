import type { ProviderSwitchMarker } from '@qlan-ro/mainframe-types';
import type { Call } from './transcript-fixture';

type Update = Record<string, unknown>;
type Tool = { title: string; input: Update; output: string; durationMs: number; failed: boolean };
type Row = Tool | { thought: string };

export type WindowPart =
  | { k: 'user'; t: string; time: string }
  | { k: 'turn'; answer: string; time: string; durationMs: number; rows: Row[] }
  | { k: 'div'; ic: string; t: string };

type Messages = {
  user: (text: string, minutes: number) => Update;
  agent: (text: string, minutes: number, duration?: number) => Update;
  call: Call;
  stamp: (minutes: number, extra?: Update) => Update;
  next: () => number;
  now: number;
};

export function windowTranscript(parts: WindowPart[], messages: Messages): Update[] {
  const { user, agent, call, stamp, next, now } = messages;
  let minutes = 0;
  return parts.flatMap((part) => {
    if (part.k === 'div') {
      const id = next();
      const providerName = /Switched to (.+?) ·/.exec(part.t)?.[1];
      const marker =
        part.ic === 'compact'
          ? { isCompacted: true }
          : {
              providerSwitch: {
                kind: 'provider_switch',
                segmentId: 'window-switch',
                fromAdapterId: 'claude',
                toAdapterId: 'mock-b',
                fromAdapterName: 'Claude',
                toAdapterName: providerName ?? part.t,
                toModel: null,
                resumed: false,
                previous: {
                  adapterId: 'claude',
                  model: 'opus-4.5',
                  turnCount: 3,
                  totalCost: 0,
                  totalTokensInput: 0,
                  totalTokensOutput: 0,
                },
                handoff: {
                  id: 'window-handoff',
                  strategy: 'full',
                  status: 'delivered',
                  itemCount: 3,
                  omittedCount: 0,
                  fellBackToFresh: false,
                },
              } satisfies ProviderSwitchMarker,
            };
      return [
        {
          sessionUpdate: 'agent_message',
          messageId: `window-marker-${id}`,
          content: [],
          _meta: stamp(minutes - 0.01, {
            containerId: `window-marker-${id}`,
            kind: 'system',
            actionable: false,
            ...marker,
          }),
        },
      ];
    }
    const timestamp = Date.parse(new Date(now).toISOString().slice(0, 10) + ' ' + part.time + ' UTC');
    minutes = (now - timestamp) / 60_000;
    if (part.k === 'user') return [user(part.t, minutes)];
    const id = next();
    const rows = part.rows.map((row, index) => {
      const key = `window-${id}-${index}`;
      if ('thought' in row)
        return {
          sessionUpdate: 'agent_thought_chunk',
          messageId: key,
          content: [{ type: 'text', text: row.thought }],
          _meta: stamp(minutes),
        };
      return {
        ...call(key, row.title, row.input, row.output, minutes, {
          ...(row.title === 'Task' && { subagent: true }),
          toolCallTiming: { startedAt: timestamp - row.durationMs, completedAt: timestamp },
        }),
        status: row.failed ? 'failed' : 'completed',
      };
    });
    return [...rows, agent(part.answer, minutes, part.durationMs)];
  });
}

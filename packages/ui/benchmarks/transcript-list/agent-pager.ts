/**
 * A long finished sub-agent for the `agent` variant (#463): `params.agentSteps` containers, each an
 * assistant message (two sentences of reasoning) and a Bash or Read call with a short output, paged
 * the way the daemon pages a sub-agent (`history_page::subagent_page`: 40 containers, the floor is
 * the page's first item, stateless). Each page arrives after `params.pageDelay` ms ±30%. No real
 * transcript content, and no daemon: the app's chat controller registry is redirected here.
 */
import type { HistoryPageResult, SessionUpdate } from '@qlan-ro/mainframe-types';
import { params } from './params';

const PAGE = 40;
const META = '_mainframe.dev';
const words = 'The step reads the module, checks what the caller expects and notes what changes next.';

function container(index: number): SessionUpdate[] {
  const id = `agent-m${index}`;
  const read = index % 3 === 0;
  const output = Array.from({ length: read ? 12 : 4 }, (_, line) => `line ${line} of step ${index}`).join('\n');
  return [
    { sessionUpdate: 'agent_message', messageId: id, content: [{ type: 'text', text: `${words} ${words}` }] },
    {
      sessionUpdate: 'tool_call_update',
      toolCallId: `agent-t${index}`,
      title: read ? 'Read' : 'Bash',
      status: 'completed',
      rawInput: read ? { file_path: `/workspace/src/module${index}.ts` } : { command: `npm test -- step${index}` },
      rawOutput: output,
      content: [{ type: 'content', content: { type: 'text', text: output } }],
      _meta: { [META]: { created: true, containerId: id } },
    },
  ] as unknown as SessionUpdate[];
}

const index = (item: string) => Number(item.slice('agent-m'.length));

export const agentPager = {
  /** `performance.now()` of every request and of every page handed back. */
  requests: [] as number[],
  landedAt: [] as number[],
  /** Called as a page is requested, before it arrives (a scenario picks the reader's anchor there). */
  onRequest: null as null | (() => void),
  total: () => params.agentSteps,
  async page(before?: string, until?: string): Promise<HistoryPageResult> {
    const total = params.agentSteps;
    agentPager.requests.push(performance.now());
    agentPager.onRequest?.();
    if (params.pageDelay > 0)
      await new Promise((resolve) => setTimeout(resolve, params.pageDelay * (0.7 + Math.random() * 0.6)));
    const end = before === undefined ? total : index(before);
    const start = before !== undefined && until !== undefined ? Math.min(index(until), end) : Math.max(0, end - PAGE);
    const updates = Array.from({ length: end - start }, (_, offset) => container(start + offset)).flat();
    agentPager.landedAt.push(performance.now());
    return { hasMore: start > 0, ...(end > start && { floorItemId: `agent-m${start}` }), updates };
  },
};

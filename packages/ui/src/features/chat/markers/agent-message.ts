/**
 * Whole-message markers the daemon's orchestration MCP server writes, so a
 * message another agent sent never reads as the user's own words:
 *
 *   `<mainframe-agent-message from="<chatId>" kind="send|launch|task">…</…>`
 *       a `chat_send` / `chat_launch` prompt or a delegated task prompt
 *   `<mainframe-task-result task="<taskId>" chat="<childChatId>" status="…">…</…>`
 *       one finished task; several sibling results batch into one message
 *
 * The daemon mirrors the agent-message parse in `message_markers.rs` so a chat
 * an agent launched is titled after its prompt, not the marker.
 */

export type AgentMessageKind = 'send' | 'launch' | 'task';

export interface AgentMessage {
  fromChatId: string;
  kind: AgentMessageKind;
  body: string;
}

export interface TaskResultMarker {
  taskId: string;
  chatId: string;
  status: string;
  body: string;
}

export type ParsedAgentText =
  { type: 'agent-message'; message: AgentMessage } | { type: 'task-results'; results: TaskResultMarker[] };

const AGENT_MESSAGE_RE =
  /^<mainframe-agent-message from="([A-Za-z0-9_-]{1,64})" kind="(send|launch|task)">\n?([\s\S]*?)\n?<\/mainframe-agent-message>$/;

const TASK_RESULT_RE =
  /<mainframe-task-result task="([A-Za-z0-9_-]{1,128})" chat="([A-Za-z0-9_-]{1,64})" status="([a-z_]+)">\n?([\s\S]*?)\n?<\/mainframe-task-result>/g;

export function parseAgentMessage(text: string): AgentMessage | null {
  const match = AGENT_MESSAGE_RE.exec(text.trim());
  if (!match) return null;
  return { fromChatId: match[1]!, kind: match[2] as AgentMessageKind, body: match[3]!.trim() };
}

/** Every task-result block, or null unless the whole message is made of them. */
export function parseTaskResults(text: string): TaskResultMarker[] | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('<mainframe-task-result ')) return null;
  const results: TaskResultMarker[] = [];
  let rest = trimmed;
  for (const match of trimmed.matchAll(TASK_RESULT_RE)) {
    results.push({ taskId: match[1]!, chatId: match[2]!, status: match[3]!, body: match[4]!.trim() });
    rest = rest.replace(match[0], '');
  }
  return results.length > 0 && rest.trim() === '' ? results : null;
}

export function parseAgentText(text: string): ParsedAgentText | null {
  const message = parseAgentMessage(text);
  if (message) return { type: 'agent-message', message };
  const results = parseTaskResults(text);
  return results ? { type: 'task-results', results } : null;
}

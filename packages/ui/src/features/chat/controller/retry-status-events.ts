/**
 * Which `session/update` frames count as new streamed content for the reconnect
 * status (todo #406): the first one clears it. Decided from the update kind and
 * its `content` alone — never `_meta`, so a retry marker cannot keep the status
 * alive or bring it back after content has arrived.
 *
 * `handle_api_retry` follows a retry with an overlay-removal upsert whose content
 * is `[]` (or `null`); metadata-only upserts omit it. None of those is content.
 */
import type { SessionUpdate } from '@qlan-ro/mainframe-types';

export function clearsRetryStatus(update: SessionUpdate): boolean {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
    case 'agent_thought_chunk':
    case 'tool_call_update':
    case 'tool_call_content_chunk':
      return true;
    case 'agent_message':
    case 'agent_thought':
      return Array.isArray(update.content) && update.content.length > 0;
    case 'state_update':
      return update.state === 'idle';
    default:
      return false;
  }
}

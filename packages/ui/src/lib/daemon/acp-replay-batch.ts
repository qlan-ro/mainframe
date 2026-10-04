/**
 * Decodes one `_mainframe.dev/replay_batch` notification (spec Decision 42)
 * back into the `session/update` payloads it carries: standard base64 of a
 * zlib-deflated JSON array. Inflating is synchronous (`fflate`), so a batch
 * dispatches in the same task it arrived in and can never be overtaken by
 * the `replay_complete` that follows it on the wire.
 *
 * A batch that cannot be decoded is dropped whole, never applied in part;
 * the replay window's own item-count check reports the gap. Each update is
 * still validated individually, exactly like a single `session/update`.
 */
import { strFromU8, unzlibSync } from 'fflate';
import {
  REPLAY_BATCH_ENCODING,
  SessionUpdateSchema,
  type ReplayBatchParams,
  type SessionUpdate,
} from '@qlan-ro/mainframe-types';

function bytesFromBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** The batch's updates in replay order, or `undefined` when the batch as a whole is unusable. */
export function decodeReplayBatch(params: ReplayBatchParams): SessionUpdate[] | undefined {
  if (params.encoding !== REPLAY_BATCH_ENCODING) {
    console.warn(`[acp-client] dropped a replay batch with an unsupported encoding "${params.encoding}"`);
    return undefined;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(unzlibSync(bytesFromBase64(params.data))));
  } catch (error) {
    console.warn('[acp-client] dropped an undecodable replay batch', error);
    return undefined;
  }
  if (!Array.isArray(raw)) {
    console.warn('[acp-client] dropped a replay batch that did not decode to an array');
    return undefined;
  }
  const updates: SessionUpdate[] = [];
  for (const entry of raw) {
    const parsed = SessionUpdateSchema.safeParse(entry);
    if (parsed.success) updates.push(parsed.data);
    else console.warn('[acp-client] dropped a malformed update inside a replay batch', entry);
  }
  if (updates.length !== params.count) {
    console.warn(`[acp-client] replay batch carried ${updates.length} usable updates, expected ${params.count}`);
  }
  return updates;
}

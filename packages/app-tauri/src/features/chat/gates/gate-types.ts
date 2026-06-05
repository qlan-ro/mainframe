import type { ControlResponse } from '@qlan-ro/mainframe-types';

/**
 * Reply callback shared by all gate cards. Matches the controller's
 * `replyToPermission(requestId, response)` seam, so `ChatGateMount` can pass
 * a single callback to every gate.
 */
export type ReplyFn = (requestId: string, response: ControlResponse) => void | Promise<void>;

import type { ControlResponse } from '@qlan-ro/mainframe-types';

/**
 * Reply callback shared by all gate cards. The response already carries its own
 * `requestId` (set from the request), so the seam takes ONLY the response — there
 * is no separate id to keep in sync, removing a "replied to the wrong entry" class.
 */
export type ReplyFn = (response: ControlResponse) => void | Promise<void>;

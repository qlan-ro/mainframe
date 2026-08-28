import type { ControlResponse, RequestPermissionResponse } from '@qlan-ro/mainframe-types';

/**
 * Reply callback shared by all gate cards. The response already carries its own
 * `requestId` (set from the request), so the seam takes ONLY the response — there
 * is no separate id to keep in sync, removing a "replied to the wrong entry" class.
 */
export type ReplyFn = (response: ControlResponse) => void | Promise<void>;

/**
 * Reply callback for the ACP facade's `session/request_permission` gates
 * (todo #350, plan task 22) — the ACP counterpart of `ReplyFn`. The request's
 * JSON-RPC id is tracked by the caller (`AcpFacadeSession.respondPermission`
 * takes only the response for the same reason `ReplyFn` does), not by the gate.
 */
export type AcpReplyFn = (response: RequestPermissionResponse) => void | Promise<void>;

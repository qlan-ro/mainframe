import type { ControlResponse } from '@qlan-ro/mainframe-types';

/**
 * Reply callback shared by all gate cards.
 *
 * The overloaded union signature covers two calling conventions:
 *  - PermissionGate: reply(requestId, response)  — two args
 *  - PlanGate:       reply(response)              — one arg (response carries requestId)
 *
 * Using a union for the first parameter keeps both callers and their tests
 * typesafe without requiring two separate types.
 */
export type ReplyFn = (
  responseOrRequestId: ControlResponse | string,
  response?: ControlResponse,
) => void | Promise<void>;

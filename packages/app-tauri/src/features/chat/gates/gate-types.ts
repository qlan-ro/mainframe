import type { ControlResponse } from '@qlan-ro/mainframe-types';

/**
 * Reply callback shared by all gate cards.
 *
 * The union first-parameter covers two calling conventions used by the
 * two gate families and their test mocks:
 *  - PermissionGate: reply(requestId, response)  — requestId is a string
 *  - PlanGate:       reply(response)              — response object carries requestId
 *
 * A union keeps both callers typesafe under a single exported name so that
 * each gate's test can import `ReplyFn` from one location. These are not
 * TypeScript function overloads — the parameter name reflects the actual
 * value at each call site.
 */
export type ReplyFn = (responseOrId: ControlResponse | string, response?: ControlResponse) => void | Promise<void>;

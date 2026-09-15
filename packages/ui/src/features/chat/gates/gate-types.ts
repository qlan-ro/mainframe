import type { ControlResponse } from '@qlan-ro/mainframe-types';

/**
 * Reply callback shared by all gate cards. The response already carries its own
 * `requestId` (set from the request), so the seam takes ONLY the response — there
 * is no separate id to keep in sync, removing a "replied to the wrong entry" class.
 * `selectedOptionId` is the adapter-supplied option the user actually clicked
 * (spec decision 12); gates that answer without picking an offered option
 * (Plan, AskUserQuestion) omit it and the session plane synthesizes one.
 */
export type ReplyFn = (response: ControlResponse, selectedOptionId?: string) => void | Promise<void>;

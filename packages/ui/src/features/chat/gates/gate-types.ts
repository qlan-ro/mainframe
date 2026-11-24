import type { ControlResponse } from '@qlan-ro/mainframe-types';

/**
 * Reply callback shared by all gate cards. The response already carries its own
 * `requestId` (set from the request), so the seam takes ONLY the response — there
 * is no separate id to keep in sync, removing a "replied to the wrong entry" class.
 * `selectedOptionId` is the adapter-supplied option the user actually clicked
 * (spec decision 12); gates that answer without picking an offered option
 * (Plan, AskUserQuestion) omit it and the session plane synthesizes one.
 */
export type ReplyFn = (response: ControlResponse, selectedOptionId?: string) => Promise<void>;

/** Who a gate is for, when it is not the session itself, and what waits behind it (G5). */
export interface GateContext {
  /** The sub-agent or delegated task asking. */
  asker?: string;
  /** What that agent is working on. */
  title?: string;
  /** How many more requests wait. */
  more: number;
}

/**
 * "Permission required · code-reviewer · 1 more waiting". A card whose heading
 * is not the asker's work names that too, so two askers of one provider read
 * apart.
 */
export function gateEyebrow(
  label: string,
  context: GateContext | undefined,
  { withTitle = false }: { withTitle?: boolean } = {},
): string {
  return [label, ...askerParts(context, withTitle)].join(' · ');
}

/** Who asks, what for, and how many wait behind. */
export function askerParts(context: GateContext | undefined, withTitle: boolean): string[] {
  if (!context) return [];
  const title = withTitle && context.title !== context.asker ? context.title : undefined;
  return [context.asker, title, context.more > 0 ? `${context.more} more waiting` : undefined].filter(
    (part): part is string => Boolean(part),
  );
}

import type { DetectedTrigger } from './types';

export interface InsertResult {
  text: string;
  cursor: number;
}

/**
 * Replaces the detected token with `directive`, separated from the following
 * text by exactly one space.
 *
 * `appendSpace: false` omits the separator so the token stays open for
 * re-detection — directory drill-down (`@dir/`) relies on it.
 */
export function insertDirective(
  text: string,
  triggerChar: string,
  trigger: DetectedTrigger,
  directive: string,
  { appendSpace = true }: { appendSpace?: boolean } = {},
): InsertResult {
  const before = text.slice(0, trigger.offset);
  const after = text.slice(trigger.offset + triggerChar.length + trigger.query.length);
  const separated = appendSpace && !after.startsWith(' ') ? ` ${after}` : after;
  return {
    text: before + directive + separated,
    cursor: before.length + directive.length + (appendSpace ? 1 : 0),
  };
}

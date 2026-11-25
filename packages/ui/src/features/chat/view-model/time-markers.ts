/** Where the transcript says the time (T1b): at its start, after a 30-minute gap, and on a new day. Pure. */
export const GAP_MS = 30 * 60_000;

interface Timed {
  readonly createdAt?: Date;
}

const valid = (message: Timed | undefined): Date | undefined =>
  message?.createdAt && Number.isFinite(message.createdAt.getTime()) ? message.createdAt : undefined;

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

const clock = (date: Date) => date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function dayName(date: Date, now: Date): string {
  if (sameDay(date, now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return 'Yesterday';
  const year = date.getFullYear() === now.getFullYear() ? undefined : 'numeric';
  return date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year });
}

/**
 * The marker above `messages[index]`, if any. `atStart`: the first loaded
 * message is the conversation's first, not just the window's.
 */
export function timeMarker(messages: readonly Timed[], index: number, atStart: boolean, now: Date): string | null {
  const date = valid(messages[index]);
  if (!date) return null;
  if (index === 0) return atStart ? `${dayName(date, now)}, ${clock(date)}` : null;
  const previous = valid(messages[index - 1]);
  if (!previous || date < previous) return null;
  if (!sameDay(previous, date)) return `${dayName(date, now)}, ${clock(date)}`;
  return date.getTime() - previous.getTime() >= GAP_MS ? clock(date) : null;
}

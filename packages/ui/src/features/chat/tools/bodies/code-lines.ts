/** A file's lines, and the numbers a read reported for them. Pure. */
export interface CodeLine {
  /** Left out for what a read said besides the file. */
  readonly number?: number;
  readonly text: string;
}

/** Lines as they are: what a call wrote, or any text that isn't a read's output. */
export function plainLines(text: string): CodeLine[] {
  return text
    .replace(/\n$/, '')
    .split('\n')
    .map((line, index) => ({ number: index + 1, text: line }));
}

/** `     8→code` (cat -n) and `8\tcode`: how the CLIs number what they read. */
const NUMBERED = /^\s*(\d+)(?:→|\t)(.*)$/;

const REMINDER = /<system-reminder>([\s\S]*?)<\/system-reminder>/g;

export interface ReadOutput {
  readonly lines: readonly CodeLine[];
  /** What the CLI told the agent after the file. */
  readonly reminders: readonly string[];
}

/**
 * A read's output. Its numbers are the CLI's only when they count up one by one;
 * otherwise the file itself starts with a number, and all of it is the file's.
 * What follows the numbered lines is kept, the CLI's reminders apart from it.
 */
export function parseRead(text: string): ReadOutput {
  const plain = { lines: plainLines(text), reminders: [] };
  const lines = text.replace(/\n$/, '').split('\n');
  const first = NUMBERED.exec(lines[0] ?? '');
  if (!first) return plain;
  const parsed: CodeLine[] = [];
  let next = Number(first[1]);
  for (const [index, line] of lines.entries()) {
    const match = NUMBERED.exec(line);
    if (match && Number(match[1]) === next) {
      parsed.push({ number: next++, text: match[2]! });
      continue;
    }
    if (parsed.length < 2 && lines.length > 1 && match) return plain;
    const rest = lines.slice(index).join('\n');
    const reminders = [...rest.matchAll(REMINDER)].map((found) => found[1]!.trim()).filter(Boolean);
    const kept = rest.replace(REMINDER, '').trim();
    return { lines: kept ? [...parsed, ...kept.split('\n').map((tail) => ({ text: tail }))] : parsed, reminders };
  }
  return { lines: parsed, reminders: [] };
}

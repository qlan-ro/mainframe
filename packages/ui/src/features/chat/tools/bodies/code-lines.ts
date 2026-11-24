/** A file's lines with the numbers a read reported. Pure. */
export interface CodeLine {
  readonly number: number;
  readonly text: string;
}

/** `     8→code` (cat -n) and `8\tcode`: how the CLIs number what they read. */
const NUMBERED = /^\s*(\d+)(?:→|\t)(.*)$/;

export function parseCodeLines(text: string): CodeLine[] {
  const lines = text.replace(/\n$/, '').split('\n');
  const first = NUMBERED.exec(lines[0] ?? '');
  if (!first) return lines.map((line, index) => ({ number: index + 1, text: line }));
  let next = Number(first[1]);
  return lines.flatMap((line) => {
    const match = NUMBERED.exec(line);
    // Only the file itself is numbered; a trailing reminder to the model is not part of it.
    if (!match) return [];
    next = Number(match[1]);
    return [{ number: next, text: match[2]! }];
  });
}

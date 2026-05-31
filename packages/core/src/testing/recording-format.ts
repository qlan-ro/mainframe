// packages/core/src/testing/recording-format.ts
export interface RecordedEvent {
  /** 'in' = daemon called the session (sendMessage/respondToPermission/interrupt); 'out' = session called the sink. */
  dir: 'in' | 'out';
  method: string;
  args: unknown[];
  /** Milliseconds since session start when this call happened. */
  delayMs: number;
}

function safeValue(v: unknown): unknown {
  if (v instanceof Error) return { name: v.name, message: v.message };
  try {
    return JSON.parse(JSON.stringify(v)) as unknown;
  } catch {
    return String(v);
  }
}

/** Reduce sink-call args to JSON-safe values so the fixture stays valid NDJSON. */
export function safeArgs(args: unknown[]): unknown[] {
  return args.map(safeValue);
}

/** Filename-safe segment from a recording key. */
export function sanitizeKey(key: string): string {
  return key
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function fixtureFileName(key: string, index: number): string {
  return `${sanitizeKey(key)}.${index}.ndjson`;
}

export function parseFixture(text: string): RecordedEvent[] {
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as RecordedEvent);
}

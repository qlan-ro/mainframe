// Parsing for Codex rollout JSONL heads: session_meta facts and the first real
// user prompt. Kept separate from the filesystem scan so both stay small.

const CWD_RE = /"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/;
// Codex's first user message bundles injected context blocks (plugins, AGENTS.md,
// environment) before the user's real prompt; each block is a separate
// `input_text`, so we skip blocks that begin with these markers.
const PREAMBLE_PREFIXES = [
  '<recommended_plugins>',
  '<environment_context>',
  '<user_instructions>',
  '<INSTRUCTIONS>',
  '# AGENTS.md instructions',
  '# Context from my IDE setup',
];

/** Project-independent facts from a rollout's session_meta. */
export interface RolloutMeta {
  cwd?: string;
  gitBranch?: string;
  createdAt?: string;
}

interface RolloutLine {
  type?: string;
  timestamp?: string;
  payload?: {
    type?: string;
    role?: string;
    timestamp?: string;
    cwd?: string;
    git?: { branch?: string };
    content?: Array<{ type?: string; text?: string }>;
  };
}

export function parseLines(chunk: string): RolloutLine[] {
  const out: RolloutLine[] = [];
  for (const line of chunk.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as RolloutLine);
    } catch {
      /* expected: truncated line at the head-byte boundary */
    }
  }
  return out;
}

/** Each user message holds one or more `input_text` blocks; return them in order. */
function userTextBlocks(line: RolloutLine): string[] {
  const p = line.payload;
  if (line.type !== 'response_item' || p?.type !== 'message' || p.role !== 'user' || !Array.isArray(p.content)) {
    return [];
  }
  return p.content.filter((c) => c?.type === 'input_text' || c?.type === 'text').map((c) => c.text ?? '');
}

function isPreamble(text: string): boolean {
  const t = text.trimStart();
  return PREAMBLE_PREFIXES.some((prefix) => t.startsWith(prefix)) || t.slice(0, 200).includes('<INSTRUCTIONS>');
}

function cleanPrompt(text: string): string {
  return text
    .replace(/<[^>]+>[^<]*<\/[^>]+>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** First block, across all user messages, that isn't injected context. */
export function firstUserPrompt(lines: RolloutLine[]): string | undefined {
  for (const line of lines) {
    for (const text of userTextBlocks(line)) {
      if (!text || isPreamble(text)) continue;
      const cleaned = cleanPrompt(text);
      if (cleaned) return cleaned.slice(0, 500);
    }
  }
  return undefined;
}

export function extractMeta(lines: RolloutLine[], head: string): RolloutMeta {
  const meta = lines.find((l) => l.type === 'session_meta')?.payload;
  // Regex fallback covers a session_meta line truncated past the read window; cwd
  // is an early field so the first match is always the real one.
  const cwd = meta?.cwd ?? CWD_RE.exec(head)?.[1];
  return { cwd, gitBranch: meta?.git?.branch || undefined, createdAt: meta?.timestamp };
}

/**
 * The row grammar every tool shares (T1, T1a): verb, target, where, receipt.
 * Pure; `ToolRow` adds the glyph, the live clock and the body.
 */
import type { ToolCallTiming } from '@assistant-ui/react';
import { resolveToolDiff } from '../../tools/shared/diff-data';
import { resolveResultText, resultImages } from '../../tools/shared/result';
import { toolKind, type ToolKind } from './tool-kind';
import {
  agentName,
  commandSummary,
  createsFile,
  exitCode,
  lineCount,
  nonBlankLines,
  toolTarget,
  type ToolTarget,
} from './tool-values';
import type { DiffStats, ToolPart, ToolStatus } from './types';
import { displayText, record } from './values';

export interface ToolRowFacts extends ToolTarget {
  readonly kind: ToolKind;
  readonly status: ToolStatus;
  readonly verb: string;
  /** An agent's name leads its row. */
  readonly strong?: boolean;
  /** "8 lines", "exit 0", "declined"; the row appends the duration. */
  readonly receipt?: string;
  readonly diff?: DiffStats;
  readonly timing?: ToolCallTiming;
  readonly reportedDurationMs?: number;
}

type Verb = readonly [base: string, running: string, past: string];
const verbs: Record<ToolKind, Verb> = {
  read: ['read', 'Reading', 'Read'],
  edit: ['edit', 'Editing', 'Edited'],
  write: ['write', 'Writing', 'Wrote'],
  grep: ['search', 'Searching', 'Searched'],
  glob: ['find', 'Finding', 'Found'],
  list: ['list', 'Listing', 'Listed'],
  'web-search': ['search the web', 'Searching the web', 'Searched the web'],
  fetch: ['fetch', 'Fetching', 'Fetched'],
  shell: ['run', 'Running', 'Ran'],
  subagent: ['run', 'Running', 'Ran'],
  delegate: ['delegate', 'Delegating', 'Delegated'],
  workflow: ['start workflow', 'Starting workflow', 'Started workflow'],
  artifact: ['publish', 'Publishing', 'Published'],
  mcp: ['call', 'Calling', 'Called'],
  unknown: ['call', 'Calling', 'Called'],
};

function verbFor(kind: ToolKind, status: ToolStatus): string {
  const [base, running, past] = verbs[kind];
  if (status === 'running') return running;
  if (status === 'declined') return `Did not ${base}`;
  if (status === 'awaiting-approval') return `Wants to ${base}`;
  return past;
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function searchReceipt(text: string): string | undefined {
  if (!text) return undefined;
  const files = /^Found (\d+) (file|match)/i.exec(text);
  if (files) return count(Number(files[1]), files[2]!.toLowerCase(), files[2] === 'match' ? 'matches' : 'files');
  if (/^No (?:files|matches) found/i.test(text)) return 'no matches';
  return count(nonBlankLines(text), 'match', 'matches');
}

function globReceipt(text: string): string | undefined {
  if (!text) return undefined;
  return /^No files found/i.test(text) ? 'no files' : count(nonBlankLines(text), 'file');
}

function imagesReceipt(part: ToolPart): string | undefined {
  const images = resultImages(part.result).length;
  return images ? count(images, 'image') : undefined;
}

/** The receipt of a call that finished. */
function doneReceipt(part: ToolPart, kind: ToolKind): string | undefined {
  const { text, truncated } = resolveResultText(part.result);
  const whole = truncated ? '' : text;
  switch (kind) {
    case 'read':
      if (resultImages(part.result).length) return 'image';
      return whole ? count(lineCount(whole), 'line') : undefined;
    case 'write': {
      const lines = lineCount(displayLines(part));
      return createsFile(part) ? `new · ${count(lines, 'line')}` : undefined;
    }
    case 'grep':
      return searchReceipt(whole);
    case 'glob':
      return globReceipt(whole);
    case 'list':
      return whole ? count(nonBlankLines(whole), 'entry', 'entries') : undefined;
    case 'shell': {
      if (record(part.args)?.run_in_background === true) return 'in the background';
      const code = commandSummary(part) ? undefined : exitCode(part, false);
      return code === undefined ? undefined : `exit ${code}`;
    }
    case 'subagent': {
      const steps = agentSteps(part);
      return steps ? count(steps, 'step') : undefined;
    }
    default:
      return imagesReceipt(part);
  }
}

function displayLines(part: ToolPart): string {
  const content = record(part.args)?.content;
  return typeof content === 'string' ? content : '';
}

/** Tool calls in a sub-agent's own transcript. */
export function agentSteps(part: ToolPart): number {
  return (part.messages ?? []).reduce(
    (sum, message) => sum + message.content.filter((entry) => entry.type === 'tool-call').length,
    0,
  );
}

function receipt(part: ToolPart, kind: ToolKind, status: ToolStatus): string | undefined {
  if (status === 'failed') {
    const code = kind === 'shell' ? exitCode(part, true) : undefined;
    return code === undefined ? 'failed' : `exit ${code}`;
  }
  if (status === 'success') return doneReceipt(part, kind);
  if (status === 'stopped' || status === 'declined') return status;
  if (status === 'awaiting-approval') return 'needs approval';
  return status === 'unknown' ? 'no result' : undefined;
}

function diffStats(part: ToolPart, kind: ToolKind, status: ToolStatus): DiffStats | undefined {
  if (status === 'failed' || (kind !== 'edit' && kind !== 'write')) return undefined;
  if (kind === 'write' && createsFile(part)) return undefined;
  return resolveToolDiff(kind === 'edit' ? 'Edit' : 'Write', part.args, part.result).stats ?? undefined;
}

const nonnegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

function suppliedTiming(value: unknown): ToolCallTiming | undefined {
  const data = record(value);
  if (!data || !nonnegative(data.startedAt)) return undefined;
  if (data.completedAt === undefined) return { startedAt: data.startedAt };
  if (!nonnegative(data.completedAt) || data.completedAt < data.startedAt) return undefined;
  return { startedAt: data.startedAt, completedAt: data.completedAt };
}

export function toolRowFacts(part: ToolPart, status: ToolStatus): ToolRowFacts {
  const kind = toolKind(part.toolName);
  const summary = kind === 'shell' ? commandSummary(part) : undefined;
  // Codex names what a command read, searched or listed; its row says so.
  const spoken = summary && status !== 'failed' ? summary.kind : kind;
  const reported = record(part.providerMetadata?.codex)?.reportedDurationMs;
  return {
    kind,
    status,
    ...toolTarget(part),
    verb: kind === 'subagent' ? agentName(part) : verbFor(spoken, status),
    ...(kind === 'subagent' && { strong: true }),
    receipt: receipt(part, kind, status),
    diff: diffStats(part, kind, status),
    timing: suppliedTiming(part.timing),
    ...(status !== 'running' && nonnegative(reported) && { reportedDurationMs: reported }),
  };
}

/** "Ran cargo test": the row's name for assistive tech and tooltips. */
export function rowName({ verb, target, where }: Pick<ToolRowFacts, 'verb' | 'target' | 'where'>): string {
  return displayText([verb, target, where].filter(Boolean).join(' '));
}

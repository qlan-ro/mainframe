/** A tool call's own words: its target, where it ran and what came back. Pure. */
import { describeArtifactCall } from '../../tools/cards/artifact-call';
import { extractResultContent, isStructuredResult, resolveResultText } from '../../tools/shared/result';
import { summarizeCommandActions } from './command-actions';
import { normalizedPath } from './file-summary';
import { toolKind } from './tool-kind';
import type { ToolPart } from './types';
import { displayText, record } from './values';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export interface ToolTarget {
  /** Empty when the call names nothing. */
  readonly target: string;
  /** Paths, commands and patterns are set in mono; titles and descriptions are not. */
  readonly mono: boolean;
  readonly where?: string;
}

/** `mcp__claude_ai_github__get_issue` → GitHub-style server and tool names. */
export function mcpName(toolName: string): { server: string; tool: string } {
  const match = /^mcp__(.+?)__(.+)$/.exec(toolName);
  if (!match) return { server: 'mcp', tool: toolName };
  const server = match[1]!.replace(/^claude_ai_/, '').replace(/_/g, ' ');
  return { server: server.charAt(0).toUpperCase() + server.slice(1), tool: match[2]! };
}

/** What Codex reported a command did, when every action is of one kind. */
export function commandSummary(part: ToolPart) {
  return summarizeCommandActions(record(part.providerMetadata?.codex)?.commandActions);
}

export function agentName(part: ToolPart): string {
  if (part.toolName === 'CollabAgent') return 'Codex agent';
  return displayText(record(part.args)?.subagent_type) || 'Agent';
}

const inPath = (path: unknown) => {
  const value = normalizedPath(path);
  return value ? `in ${value}` : undefined;
};
const quoted = (value: string) => (value ? `"${value}"` : '');

export function toolTarget(part: ToolPart): ToolTarget {
  const args = record(part.args) ?? {};
  const mono = (target: string, where?: string): ToolTarget => ({ target, mono: true, where });
  const prose = (target: string, where?: string): ToolTarget => ({ target, mono: false, where });
  switch (toolKind(part.toolName)) {
    case 'read':
    case 'edit':
    case 'write':
      return mono(normalizedPath(args.file_path ?? args.notebook_path));
    case 'grep':
      return mono(quoted(displayText(args.pattern)), inPath(args.path));
    case 'glob':
      return mono(displayText(args.pattern ?? args.glob), inPath(args.path));
    case 'list':
      return mono(normalizedPath(args.path));
    case 'web-search':
      return mono(quoted(displayText(args.query)));
    case 'fetch':
      return mono(displayText(args.url).replace(/^https?:\/\//, ''));
    case 'shell':
      return mono(commandSummary(part)?.target ?? displayText(args.command ?? args.input));
    case 'subagent':
      return prose(displayText(args.description) || displayText(args.prompt));
    case 'delegate':
      return prose(displayText(args.title) || displayText(args.task));
    case 'workflow':
      return mono(displayText(args.name ?? args.workflow));
    case 'artifact':
      return prose(describeArtifactCall(args, resolveResultText(part.result).text).label ?? '');
    case 'mcp': {
      const { server, tool } = mcpName(part.toolName);
      return mono(tool, `on ${server}`);
    }
    default:
      return mono(displayText(part.toolName) || 'tool');
  }
}

/** Arguments that don't change what a call does. */
const INCIDENTAL: ReadonlySet<string> = new Set(['description', 'timeout', 'run_in_background']);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  const fields = record(value);
  if (!fields) return value;
  return Object.keys(fields)
    .sort()
    .map((key) => [key, canonical(fields[key])]);
}

/**
 * The call itself: what "retried" compares (T1b). Two calls are the same only
 * when they ask for the same thing, so another edit of the same file, or another
 * workflow, never passes for a retry. A call that names nothing matches no other.
 */
export function retryKey(part: ToolPart): string {
  const args = Object.entries(record(part.args) ?? {}).filter(([key]) => !INCIDENTAL.has(key));
  if (!args.length) return JSON.stringify([part.toolName, part.toolCallId]);
  return JSON.stringify([part.toolName, canonical(Object.fromEntries(args))]);
}

/**
 * The CLI's own words for a command it moved to the background by itself: the
 * call carries no `run_in_background` then.
 */
const BACKGROUNDED =
  /^Command (?:is )?(?:still )?running in (?:the )?background with ID|^Command did not complete within .* and was moved to the background|^Command was (?:automatically |manually )?(?:backgrounded|moved to the background)/i;

/** A command whose output goes on after its call returned. */
export function runsInBackground(part: ToolPart): boolean {
  return (
    record(part.args)?.run_in_background === true || BACKGROUNDED.test(extractResultContent(part.result).trimStart())
  );
}

/** The exit code a command reported. A call that did not fail exited 0; a failed one states its code or stays unknown. */
export function exitCode(part: ToolPart, failed: boolean): number | undefined {
  const output = resolveResultText(part.result).text;
  const stated = /^(?:Exit code|exit)\s+(\d+)\b/im.exec(output.slice(0, 200)) ?? /\bexit\s+(\d+)\s*$/i.exec(output);
  if (stated) return Number(stated[1]);
  return failed || runsInBackground(part) ? undefined : 0;
}

export const nonBlankLines = (value: string): number => value.split('\n').filter((line) => line.trim()).length;

/** Lines of text a file read returned, without the CLI's trailing reminders. */
export function lineCount(value: string): number {
  return value ? value.replace(/\n$/, '').split('\n').length : 0;
}

/** A Write whose file did not exist before. */
export function createsFile(part: ToolPart): boolean {
  if (isStructuredResult(part.result)) return !part.result.originalFile;
  return /^File created successfully/i.test(extractResultContent(part.result));
}

export const argText = (part: ToolPart, key: string): string => text(record(part.args)?.[key]);

import type { CompactToolPart, ToolStatus } from './types';
import { actionLabel } from './action-label';
import { summarizeCommandActions } from './command-actions';
import { classifyCommand } from './command-classify';
import { parseShellCommand, programName } from './shell-command';
import { displayText, record } from './values';

export function commandLabel(part: CompactToolPart, status: ToolStatus): string {
  const args = record(part.args);
  const metadata = record(part.providerMetadata?.codex);
  const tokens = parseShellCommand(args?.command);
  const action = summarizeCommandActions(metadata?.commandActions) ?? (tokens ? classifyCommand(tokens) : undefined);
  if (action) return actionLabel(action, status);
  const description = displayText(args?.description);
  if (description) return actionLabel({ kind: 'command', target: description }, status);
  const program = tokens ? displayText(programName(tokens[0]!)) : '';
  const raw = displayText(args?.command);
  const target = status === 'running' ? program || 'command' : raw || 'command';
  return actionLabel({ kind: 'command', target }, status);
}

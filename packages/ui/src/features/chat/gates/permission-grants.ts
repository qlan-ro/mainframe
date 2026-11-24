/**
 * What "Always allow" saves (G2). The answer carries exactly these updates and
 * the gate lists every one of them, so nothing is saved that was not read.
 *
 * A CLI can suggest a wider permission mode alongside a rule. A mode that
 * approves more than file edits is never taken from a suggestion: it is dropped
 * from the answer, and choosing it stays a deliberate act on the composer's
 * permissions control.
 */
import type { ControlUpdate } from '@qlan-ro/mainframe-types';
import { permissionLabel } from '../composer/config-toolbar/permission-modes';

/** The modes a suggestion may switch to, in the CLI's spelling. */
const GRANTABLE_MODES: readonly string[] = ['default', 'plan', 'acceptEdits'];

export function grantedUpdates(suggestions: readonly ControlUpdate[] | undefined): ControlUpdate[] {
  return (suggestions ?? []).filter((update) => update.type !== 'setMode' || GRANTABLE_MODES.includes(update.mode));
}

const DESTINATION: Record<string, string> = {
  userSettings: 'in your settings, for every project',
  projectSettings: 'in this project’s shared settings',
  localSettings: 'in this project’s local settings',
  session: 'for this session',
  cliArg: 'for this session',
};

const where = (destination: string): string => DESTINATION[destination] ?? `in ${destination}`;

type Rule = { toolName: string; ruleContent?: string };

/** The CLI's own spelling: `Bash(cargo test *)`, or the bare tool name for every use of it. */
const ruleText = (rule: Rule): string => (rule.ruleContent ? `${rule.toolName}(${rule.ruleContent})` : rule.toolName);

export interface GrantLine {
  /** "Allow", "Deny", "Stop asking about"… */
  verb: string;
  /** The rule, the directories or the mode, in full. */
  subject: string;
  where: string;
}

const RULE_VERB: Record<string, string> = { allow: 'Allow', deny: 'Deny', ask: 'Ask before' };

function linesFor(update: ControlUpdate): GrantLine[] {
  switch (update.type) {
    case 'addRules':
      return update.rules.map((rule) => ({
        verb: RULE_VERB[update.behavior] ?? update.behavior,
        subject: ruleText(rule),
        where: where(update.destination),
      }));
    case 'replaceRules':
      return [
        {
          verb: `Replace every “${update.behavior}” rule with`,
          subject: update.rules.map(ruleText).join(', ') || 'nothing',
          where: where(update.destination),
        },
      ];
    case 'removeRules':
      return update.rules.map((rule) => ({
        verb: `Remove the “${update.behavior}” rule`,
        subject: ruleText(rule),
        where: where(update.destination),
      }));
    case 'setMode':
      // The daemon keeps a suggested mode to the session, whatever destination it names.
      return [
        {
          verb: 'Switch permissions to',
          subject: update.mode === 'plan' ? 'Planning' : permissionLabel(update.mode),
          where: where('session'),
        },
      ];
    case 'addDirectories':
      return update.directories.map((dir) => ({ verb: 'Work in', subject: dir, where: where(update.destination) }));
    case 'removeDirectories':
      return update.directories.map((dir) => ({
        verb: 'Stop working in',
        subject: dir,
        where: where(update.destination),
      }));
  }
}

/** One line per thing saved, in the CLI's order. */
export function grantLines(updates: readonly ControlUpdate[]): GrantLine[] {
  return updates.flatMap(linesFor);
}

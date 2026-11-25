/**
 * What "Always allow" saves (G2). The answer carries exactly these updates and
 * the gate lists every one of them, so nothing is saved that was not read.
 *
 * Two kinds of suggestion are left out of both, and the gate says so:
 *  - a permission mode that approves more than file edits. Choosing one stays a
 *    deliberate act on the composer's permissions control;
 *  - anything this build cannot read in full. What cannot be listed is not sent.
 *
 * The daemon holds the same line for every client
 * (`mainframe-types/src/adapter/control_update.rs`).
 */
import type { ControlDestination, ControlUpdate, PermissionMode } from '@qlan-ro/mainframe-types';
import { PERMISSION_MODES, permissionLabel } from '../composer/config-toolbar/permission-modes';
import { visibleLine } from './visible-text';

/** The modes a suggestion may switch to, in the CLI's spelling. */
const GRANTABLE_MODES: readonly string[] = ['default', 'plan', 'acceptEdits'];
const KNOWN_TYPES = ['addRules', 'replaceRules', 'removeRules', 'setMode', 'addDirectories', 'removeDirectories'];

const DESTINATION: Record<ControlDestination, string> = {
  userSettings: 'in your settings, for every project',
  projectSettings: 'in this project’s shared settings',
  localSettings: 'in this project’s local settings',
  session: 'for this session',
  cliArg: 'for this session',
};

type Rule = { toolName: string; ruleContent?: string };
type Behavior = 'allow' | 'deny' | 'ask';
type Fields = Record<string, unknown>;

const isFields = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isDestination = (value: unknown): value is ControlDestination =>
  typeof value === 'string' && Object.keys(DESTINATION).includes(value);
const isBehavior = (value: unknown): value is Behavior => value === 'allow' || value === 'deny' || value === 'ask';

/** Every item read, or nothing: a list that is half understood is not understood. */
function readList<T>(value: unknown, read: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const items: T[] = [];
  for (const entry of value) {
    const item = read(entry);
    if (item === null) return null;
    items.push(item);
  }
  return items;
}

function readRule(value: unknown): Rule | null {
  if (!isFields(value) || typeof value.toolName !== 'string' || value.toolName === '') return null;
  const { toolName, ruleContent } = value;
  if (ruleContent === undefined) return { toolName };
  return typeof ruleContent === 'string' ? { toolName, ruleContent } : null;
}

const readDirectory = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/**
 * The update rebuilt from the fields the gate lists, or null for a shape it
 * cannot list. Rebuilt, so a field this build does not know is not sent along.
 */
function readUpdate(value: unknown): ControlUpdate | null {
  if (!isFields(value) || !isDestination(value.destination)) return null;
  const { destination } = value;
  switch (value.type) {
    case 'addRules':
    case 'removeRules':
    case 'replaceRules': {
      const rules = readList(value.rules, readRule);
      if (!rules || !isBehavior(value.behavior)) return null;
      // Replacing with nothing clears the rules; adding or removing nothing has no line to show.
      if (rules.length === 0 && value.type !== 'replaceRules') return null;
      return { type: value.type, rules, behavior: value.behavior, destination };
    }
    case 'setMode':
      return typeof value.mode === 'string' && GRANTABLE_MODES.includes(value.mode)
        ? { type: 'setMode', mode: value.mode as PermissionMode, destination }
        : null;
    case 'addDirectories':
    case 'removeDirectories': {
      const directories = readList(value.directories, readDirectory);
      return directories && directories.length > 0 ? { type: value.type, directories, destination } : null;
    }
    default:
      return null;
  }
}

const NAME_LIMIT = 60;
/** A name from an update we could not read: quoted, on one line, and cut short. */
function quoted(name: string): string {
  const chars = Array.from(name);
  return `“${visibleLine(chars.slice(0, NAME_LIMIT).join(''))}${chars.length > NAME_LIMIT ? '…' : ''}”`;
}

/** `bypassPermissions` is the CLI's spelling of Unattended. */
function modeName(mode: string): string {
  const id = mode === 'bypassPermissions' ? 'yolo' : mode;
  return PERMISSION_MODES.find((known) => known.id === id)?.label ?? quoted(mode);
}

function describeOmitted(value: unknown): string {
  if (!isFields(value) || typeof value.type !== 'string') return 'a change that could not be read';
  if (value.type === 'setMode' && typeof value.mode === 'string' && !GRANTABLE_MODES.includes(value.mode)) {
    return `switching permissions to ${modeName(value.mode)}`;
  }
  return KNOWN_TYPES.includes(value.type)
    ? `a change that could not be read (${quoted(value.type)})`
    : `a kind of change this version does not know (${quoted(value.type)})`;
}

export interface SuggestedGrants {
  /** Sent by "Always allow", and listed. */
  updates: ControlUpdate[];
  /** Never sent: one description per suggestion left out. */
  omitted: string[];
}

/** `suggestions` is whatever arrived: nothing has checked its shape. */
export function readSuggestions(suggestions: unknown): SuggestedGrants {
  const grants: SuggestedGrants = { updates: [], omitted: [] };
  if (suggestions === undefined || suggestions === null) return grants;
  for (const suggestion of Array.isArray(suggestions) ? (suggestions as unknown[]) : [suggestions]) {
    const update = readUpdate(suggestion);
    if (update) grants.updates.push(update);
    else grants.omitted.push(describeOmitted(suggestion));
  }
  return grants;
}

export const grantedUpdates = (suggestions: unknown): ControlUpdate[] => readSuggestions(suggestions).updates;

const where = (destination: ControlDestination): string => DESTINATION[destination];

/** The CLI's own spelling: `Bash(cargo test *)`, or the bare tool name for every use of it. */
const ruleText = (rule: Rule): string =>
  visibleLine(rule.ruleContent ? `${rule.toolName}(${rule.ruleContent})` : rule.toolName);

export interface GrantLine {
  /** "Allow", "Deny", "Stop asking about"… */
  verb: string;
  /** The rule, the directory or the mode, in full and with nothing hidden in it. */
  subject: string;
  where: string;
}

const RULE_VERB: Record<Behavior, string> = { allow: 'Allow', deny: 'Deny', ask: 'Ask before' };

function linesFor(update: ControlUpdate): GrantLine[] {
  switch (update.type) {
    case 'addRules':
      return update.rules.map((rule) => ({
        verb: RULE_VERB[update.behavior],
        subject: ruleText(rule),
        where: where(update.destination),
      }));
    case 'replaceRules':
      if (update.rules.length === 0) {
        return [{ verb: 'Remove every', subject: `“${update.behavior}” rule`, where: where(update.destination) }];
      }
      return update.rules.map((rule, index) => ({
        verb: index === 0 ? `Replace every “${update.behavior}” rule with` : 'and with',
        subject: ruleText(rule),
        where: where(update.destination),
      }));
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
      return update.directories.map((dir) => ({
        verb: 'Work in',
        subject: visibleLine(dir),
        where: where(update.destination),
      }));
    case 'removeDirectories':
      return update.directories.map((dir) => ({
        verb: 'Stop working in',
        subject: visibleLine(dir),
        where: where(update.destination),
      }));
    default:
      return [];
  }
}

/** One line per thing saved, in the CLI's order. */
export function grantLines(updates: readonly ControlUpdate[]): GrantLine[] {
  return updates.flatMap(linesFor);
}

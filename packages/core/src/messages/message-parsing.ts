import type { Skill } from '@mainframe/types';

// TODO: Big, the parsing in this class is mostly related to a specific implementation (Claude), I feel like all Claude related classes should live under adapters/claude/
export const COMMAND_NAME_RE = /<command-name>\/?([^<]*)<\/command-name>/;
export const ATTACHED_FILE_PATH_RE = /<attached_file_path\s+([^>]+?)\/?>/g;
export const IMAGE_COORDINATE_NOTE_RE =
  /\[Image:\s*original\s+\d+x\d+,\s*displayed at\s+\d+x\d+\.\s*Multiply coordinates by\s+[0-9.]+\s+to map to original image\.\]/g; // TODO remove this, should not be used

export function parseCommandMessage(text: string): { commandName: string; userText: string } | null {
  const match = text.match(COMMAND_NAME_RE);
  if (!match) return null;
  const commandName = match[1]!;
  const argsMatch = text.match(/<command-args>([^<]*)<\/command-args>/);
  const commandArgs = argsMatch?.[1]?.trim() ?? '';
  const userText = text
    .replace(/<command-message>[^<]*<\/command-message>/g, '')
    .replace(/<command-name>[^<]*<\/command-name>/g, '')
    .replace(/<command-args>[^<]*<\/command-args>/g, '')
    .replace(/<local-command-caveat>[^<]*<\/local-command-caveat>/g, '')
    .replace(/<local-command-stdout>[^<]*<\/local-command-stdout>/g, '')
    .trim();
  return { commandName, userText: commandArgs || userText };
}

export function resolveSkillName(name: string, skills: Skill[]): string {
  const exact = skills.find((s) => s.invocationName === name || s.name === name);
  if (exact) return exact.invocationName || exact.name;
  const suffix = skills.find((s) => s.invocationName?.endsWith(`:${name}`));
  if (suffix) return suffix.invocationName!;
  return name;
}

export function parseRawCommand(text: string, skills: Skill[]): { commandName: string; userText: string } | null {
  if (!text.startsWith('/')) return null;
  const match = text.match(/^\/(\S+)/);
  if (!match) return null;
  const rawName = match[1]!;
  const isKnown = skills.some(
    (s) => s.invocationName === rawName || s.name === rawName || s.invocationName?.endsWith(`:${rawName}`),
  );
  if (!isKnown) return null;
  const resolved = resolveSkillName(rawName, skills);
  const userText = text.slice(match[0].length).trim();
  return { commandName: resolved, userText };
}

export function decodeXmlAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function parseAttachedFilePathTags(text: string): { files: { name: string }[]; cleanText: string } {
  const files: { name: string }[] = [];
  const cleanText = text
    .replace(ATTACHED_FILE_PATH_RE, (_full, attrs: string) => {
      const nameMatch = attrs.match(/name="([^"]+)"/);
      if (nameMatch?.[1]) {
        files.push({ name: decodeXmlAttr(nameMatch[1]) });
      }
      return '';
    })
    .replace(IMAGE_COORDINATE_NOTE_RE, '')
    .trim();
  return { files, cleanText };
}

export function formatTurnDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return '';
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  const seconds = durationMs / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds)}s`;
}

const MAINFRAME_CMD_RESPONSE_RE = /<mainframe-command-response[^>]*>([\s\S]*?)<\/mainframe-command-response>/;
const MAINFRAME_CMD_WRAPPER_RE = /<mainframe-command[^>]*>[\s\S]*?<\/mainframe-command>/;

export function stripMainframeCommandTags(text: string): string {
  const responseMatch = text.match(MAINFRAME_CMD_RESPONSE_RE);
  if (responseMatch) {
    return responseMatch[1]!.trim();
  }
  return text.replace(MAINFRAME_CMD_WRAPPER_RE, '').trim();
}

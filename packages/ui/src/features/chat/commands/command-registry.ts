/**
 * The slash commands the daemon offers, published once they load and read back
 * imperatively when a message is sent.
 *
 * A module-level store rather than context because the reader is
 * `ChatThreadController`, which is not a React component and cannot take one —
 * the same shape `session-reference-store` uses for the `@` references folded
 * in at submit.
 */
import type { CustomCommand } from '@qlan-ro/mainframe-types';

let published: readonly CustomCommand[] = [];

export function publishCommands(commands: readonly CustomCommand[]): void {
  published = commands;
}

/** Wire shape for `message.send`'s `metadata.command`. */
export interface CommandInvocation {
  name: string;
  source: string;
}

// The daemon rejects any name outside this charset (ws_schemas' `is_command_name`),
// so a token that could never match is not worth a lookup.
const INVOCATION = /^\/([a-zA-Z0-9_-]+)$/;

/**
 * The command a draft invokes, or null when it is an ordinary message.
 *
 * The command must be the WHOLE draft. `/launch-config` invokes it;
 * `/launch-config for the api package` does not, and is sent as plain text
 * instead — a Mainframe command replaces the content with its own prompt
 * template, so treating that draft as an invocation would silently discard
 * everything the user typed after the name. The picker inserts a trailing
 * space, so the trim is load-bearing rather than cosmetic.
 */
export function matchCommandInvocation(
  text: string,
  available: readonly CustomCommand[] = published,
): CommandInvocation | null {
  const match = INVOCATION.exec(text.trim());
  if (!match) return null;
  const command = available.find((c) => c.name === match[1]);
  return command ? { name: command.name, source: command.source } : null;
}

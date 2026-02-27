import type { CustomCommand } from '@mainframe/types';

/**
 * Static registry of Mainframe-defined custom commands.
 * Empty for v1 — the framework is ready for future commands.
 */
const MAINFRAME_COMMANDS: CustomCommand[] = [];

export function getMainframeCommands(): CustomCommand[] {
  return MAINFRAME_COMMANDS;
}

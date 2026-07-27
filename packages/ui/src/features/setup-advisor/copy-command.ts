/**
 * Clipboard write for the Setup Advisor command row. Deliberately not a
 * cross-feature abstraction — the sheet is the only consumer (spec Data flow).
 */
export function copyCommand(command: string): Promise<void> {
  return navigator.clipboard.writeText(command);
}

/**
 * Build a reference string from file path + symbol info.
 *
 * Tier 1 (symbol chain): `path::SymbolChain`
 * Tier 2 (word only):    `path:line (word)`
 * Tier 3 (nothing):      `path:line`
 */
export function buildReference(
  filePath: string | undefined,
  line: number,
  symbolChain?: string,
  word?: string,
  lineOffset?: number,
): string {
  const path = filePath ?? 'untitled';
  if (symbolChain) return `${path}::${symbolChain}`;
  const adjustedLine = line + (lineOffset ?? 0);
  if (word) return `${path}:${adjustedLine} (${word})`;
  return `${path}:${adjustedLine}`;
}

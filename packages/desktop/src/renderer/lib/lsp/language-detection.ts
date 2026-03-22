const EXTENSION_TO_LSP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'typescript',
  '.jsx': 'typescript',
  '.py': 'python',
  '.pyi': 'python',
  '.java': 'java',
};

/** Get the LSP language server ID for a file path, or null if not supported. */
export function getLspLanguage(filePath: string): string | null {
  const ext = filePath.slice(filePath.lastIndexOf('.'));
  return EXTENSION_TO_LSP[ext] ?? null;
}

/** Check if a file extension has LSP support. */
export function hasLspSupport(filePath: string): boolean {
  return getLspLanguage(filePath) !== null;
}

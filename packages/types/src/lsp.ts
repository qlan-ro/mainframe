/** Configuration for an LSP server binary. */
export interface LspServerConfig {
  /** Language identifier: 'typescript', 'python', 'java' */
  id: string;
  /** File extensions this server handles: ['.ts', '.tsx', '.js', '.jsx'] */
  languages: string[];
  /** Server binary command or resolved path */
  command: string;
  /** CLI arguments: ['--stdio'] */
  args: string[];
  /** Whether the server is bundled with mainframe-core */
  bundled: boolean;
}

/** Per-language LSP availability status for a project. */
export interface LspLanguageStatus {
  id: string;
  installed: boolean;
  active: boolean;
}

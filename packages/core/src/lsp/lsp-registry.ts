import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { LspServerConfig } from '@qlan-ro/mainframe-types';
import { createChildLogger } from '../logger.js';

const require = createRequire(import.meta.url ?? __filename);
const execFileAsync = promisify(execFile);
const log = createChildLogger('lsp-registry');

const CONFIGS: LspServerConfig[] = [
  {
    id: 'typescript',
    languages: ['.ts', '.tsx', '.js', '.jsx'],
    command: 'typescript-language-server',
    args: ['--stdio'],
    bundled: true,
  },
  {
    id: 'python',
    languages: ['.py', '.pyi'],
    command: 'pyright-langserver',
    args: ['--stdio'],
    bundled: true,
  },
  {
    id: 'java',
    languages: ['.java'],
    command: 'jdtls',
    args: [],
    bundled: false,
  },
];

/** Maps bundled language IDs to their npm package name and bin path within that package. */
const BUNDLED_BIN_MAP: Record<string, { pkg: string; bin: string }> = {
  typescript: { pkg: 'typescript-language-server', bin: 'lib/cli.mjs' },
  python: { pkg: 'pyright', bin: 'dist/pyright-langserver.js' },
};

function resolveBundledBinPath(languageId: string): string {
  const entry = BUNDLED_BIN_MAP[languageId];
  if (!entry) throw new Error(`No bundled bin map entry for '${languageId}'`);
  const pkgJsonPath = require.resolve(`${entry.pkg}/package.json`);
  const pkgDir = pkgJsonPath.replace(/\/package\.json$/, '');
  return `${pkgDir}/${entry.bin}`;
}

export class LspRegistry {
  private configs = new Map<string, LspServerConfig>();
  private extensionMap = new Map<string, string>();

  constructor() {
    for (const config of CONFIGS) {
      this.configs.set(config.id, config);
      for (const ext of config.languages) {
        this.extensionMap.set(ext, config.id);
      }
    }
  }

  getConfig(languageId: string): LspServerConfig | undefined {
    return this.configs.get(languageId);
  }

  getLanguageForExtension(ext: string): string | null {
    return this.extensionMap.get(ext) ?? null;
  }

  getAllLanguageIds(): string[] {
    return [...this.configs.keys()];
  }

  async resolveCommand(languageId: string): Promise<{ command: string; args: string[] } | null> {
    const config = this.configs.get(languageId);
    if (!config) return null;

    if (config.bundled) {
      try {
        const binPath = resolveBundledBinPath(languageId);
        return { command: process.execPath, args: [binPath, ...config.args] };
      } catch (err) {
        log.warn({ languageId, err }, 'Bundled LSP server package not found');
        return null;
      }
    }

    try {
      await execFileAsync('/bin/sh', ['-c', `command -v ${config.command}`]);
      return { command: config.command, args: config.args };
    } catch (err) {
      log.debug({ languageId, cmd: config.command, err }, 'External LSP server not found on PATH');
      return null;
    }
  }
}

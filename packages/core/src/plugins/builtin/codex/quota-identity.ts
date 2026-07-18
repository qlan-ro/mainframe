import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Account } from './types.js';
import { createChildLogger } from '../../../logger.js';

const log = createChildLogger('codex:quota-identity');

/** No account and no fallback identified it → a fixed synthetic bucket (carries no quota anyway). */
export const CODEX_IDENTITY_UNKNOWN = 'unknown';
/** A transient read failure (RPC error, locked/unreadable auth.json) → reuse the last-known identity. */
export const CODEX_IDENTITY_TRANSIENT = 'transient:identity-read-failed';

interface CodexAuthFile {
  tokens?: { account_id?: string };
}

const DEFAULT_AUTH_JSON_PATH = join(homedir(), '.codex', 'auth.json');

export interface ReadCodexAccountIdentityDeps {
  /** `account/read` over the app-server connection already in use for the quota pull. */
  readAccount: () => Promise<Account | null>;
  /** Plaintext fallback when the account has no usable email. Defaults to ~/.codex/auth.json. */
  readAuthFile?: () => Promise<CodexAuthFile | null>;
}

/**
 * Resolve the logged-in Codex account identity: `account/read`'s email first, then
 * ~/.codex/auth.json's `tokens.account_id`, then a synthetic `apiKey`/`bedrock` bucket
 * for keyless auth. A transient RPC or file read failure yields `CODEX_IDENTITY_TRANSIENT`
 * so a momentary hiccup never flips a healthy gauge to the wrong account.
 */
export async function readCodexAccountIdentity(deps: ReadCodexAccountIdentityDeps): Promise<string> {
  let account: Account | null;
  try {
    account = await deps.readAccount();
  } catch (err) {
    log.warn({ err }, 'codex account/read failed; identity transient');
    return CODEX_IDENTITY_TRANSIENT;
  }

  if (account?.type === 'chatgpt' && account.email) return account.email;

  let authFile: CodexAuthFile | null;
  try {
    authFile = await (deps.readAuthFile ?? readDefaultAuthFile)();
  } catch (err) {
    log.warn({ err }, 'codex auth.json unreadable; identity transient');
    return CODEX_IDENTITY_TRANSIENT;
  }
  const accountId = authFile?.tokens?.account_id;
  if (typeof accountId === 'string' && accountId) return accountId;

  return syntheticBucket(account);
}

function syntheticBucket(account: Account | null): string {
  if (account?.type === 'apiKey') return 'apiKey';
  if (account?.type === 'amazonBedrock') return 'bedrock';
  log.info({ account }, 'codex: no identifiable account; identity unknown');
  return CODEX_IDENTITY_UNKNOWN;
}

/** ENOENT (no auth.json) is not a failure — it just yields no account-id fallback. */
async function readDefaultAuthFile(): Promise<CodexAuthFile | null> {
  let raw: string;
  try {
    raw = await readFile(DEFAULT_AUTH_JSON_PATH, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  return JSON.parse(raw) as CodexAuthFile;
}

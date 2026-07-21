import { describe, it, expect } from 'vitest';
import { readCodexAccountIdentity, CODEX_IDENTITY_UNKNOWN, CODEX_IDENTITY_TRANSIENT } from '../quota-identity.js';

describe('readCodexAccountIdentity', () => {
  it('returns the account/read email for a chatgpt account', async () => {
    const identity = await readCodexAccountIdentity({
      readAccount: async () => ({ type: 'chatgpt', email: 'a@b.com', planType: 'plus' }),
    });
    expect(identity).toBe('a@b.com');
  });

  it('falls back to ~/.codex/auth.json tokens.account_id when the chatgpt account has no email', async () => {
    const identity = await readCodexAccountIdentity({
      readAccount: async () => ({ type: 'chatgpt', email: null, planType: 'plus' }),
      readAuthFile: async () => ({ tokens: { account_id: 'uuid-456' } }),
    });
    expect(identity).toBe('uuid-456');
  });

  it('returns a synthetic apiKey bucket when there is no email and no auth.json fallback', async () => {
    const identity = await readCodexAccountIdentity({
      readAccount: async () => ({ type: 'apiKey' }),
      readAuthFile: async () => null,
    });
    expect(identity).toBe('apiKey');
  });

  it('returns a synthetic bedrock bucket for amazonBedrock accounts', async () => {
    const identity = await readCodexAccountIdentity({
      readAccount: async () => ({ type: 'amazonBedrock', credentialSource: 'env' }),
      readAuthFile: async () => null,
    });
    expect(identity).toBe('bedrock');
  });

  it('returns the unknown bucket when there is no account at all', async () => {
    const identity = await readCodexAccountIdentity({
      readAccount: async () => null,
      readAuthFile: async () => null,
    });
    expect(identity).toBe(CODEX_IDENTITY_UNKNOWN);
  });

  it('returns the transient sentinel when account/read fails', async () => {
    const identity = await readCodexAccountIdentity({
      readAccount: async () => {
        throw new Error('app-server unreachable');
      },
    });
    expect(identity).toBe(CODEX_IDENTITY_TRANSIENT);
  });

  it('returns the transient sentinel when auth.json is present but unreadable', async () => {
    const identity = await readCodexAccountIdentity({
      readAccount: async () => ({ type: 'apiKey' }),
      readAuthFile: async () => {
        throw new Error('EACCES');
      },
    });
    expect(identity).toBe(CODEX_IDENTITY_TRANSIENT);
  });
});

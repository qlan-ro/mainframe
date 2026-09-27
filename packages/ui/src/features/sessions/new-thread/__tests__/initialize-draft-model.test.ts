import { beforeEach, expect, it, vi } from 'vitest';
import type { AdapterInfo } from '@qlan-ro/mainframe-types';
import { getEffectiveModel } from '@/lib/api/adapters';
import { getProviderSettings } from '@/lib/api/settings';
import { initializeDraft } from '../initialize-draft';
import { useDraftConfigStore } from '../../runtime/draft-config';
import { useNewThreadReady } from '../../runtime/new-thread-ready-store';

vi.mock('@/lib/api/adapters', () => ({ getEffectiveModel: vi.fn() }));
vi.mock('@/lib/api/settings', () => ({ getProviderSettings: vi.fn() }));

const adapters = [
  {
    id: 'claude',
    models: [
      { id: 'default', label: 'Use CLI setting', isDefault: true },
      { id: 'fable', label: 'Fable 5.1', resolvedModel: 'claude-fable-5-1' },
      { id: 'claude-opus-5', label: 'Opus 5' },
    ],
  },
] as AdapterInfo[];
const args = { localId: '__LOCALID_test', projectId: 'project', port: 31415, defaultAdapterId: 'claude', adapters };

beforeEach(() => {
  vi.mocked(getEffectiveModel).mockReset().mockResolvedValue('claude-fable-5-1');
  vi.mocked(getProviderSettings).mockReset().mockResolvedValue({});
  useDraftConfigStore.setState({ drafts: new Map() });
  useNewThreadReady.setState({ readyIds: new Set(), initializations: new Map() });
});

it('resolves the project CLI configuration while preserving inheritance', async () => {
  expect(await initializeDraft(args)).toMatchObject({ model: 'default', cliModel: 'claude-fable-5-1' });
  expect(getEffectiveModel).toHaveBeenCalledWith(31415, 'claude', 'project');
});

it('uses a Mainframe settings override without consulting the CLI default', async () => {
  vi.mocked(getProviderSettings).mockResolvedValue({ claude: { defaultModel: 'claude-opus-5' } });
  const draft = await initializeDraft(args);
  expect(draft.model).toBe('claude-opus-5');
  expect(draft.cliModel).toBeUndefined();
  expect(getEffectiveModel).not.toHaveBeenCalled();
});

it('keeps inheritance unresolved when the CLI cannot report a model', async () => {
  vi.mocked(getEffectiveModel).mockResolvedValue(null);
  const draft = await initializeDraft(args);
  expect(draft.model).toBe('default');
  expect(draft.cliModel).toBeUndefined();
});

it('inherits Codex project configuration instead of the recommended catalog model', async () => {
  vi.mocked(getEffectiveModel).mockResolvedValue('gpt-private');
  const codex = {
    ...adapters[0],
    id: 'codex',
    models: [{ id: 'gpt-recommended', label: 'GPT Recommended', isDefault: true }],
  } as AdapterInfo;
  const draft = await initializeDraft({ ...args, adapters: [codex], defaultAdapterId: 'codex' });
  expect(draft).toMatchObject({ model: 'default', cliModel: 'gpt-private' });
  expect(getEffectiveModel).toHaveBeenCalledWith(31415, 'codex', 'project');
});

it('preserves provider model IDs outside the current catalog', async () => {
  vi.mocked(getProviderSettings).mockResolvedValue({ claude: { defaultModel: 'private-model' } });
  expect(await initializeDraft(args)).toMatchObject({ model: 'private-model' });
  expect(getEffectiveModel).not.toHaveBeenCalled();
});

it('preserves a pinned provider model even when the catalog only has its moving alias', async () => {
  vi.mocked(getProviderSettings).mockResolvedValue({ claude: { defaultModel: 'claude-fable-5-1' } });
  expect(await initializeDraft(args)).toMatchObject({ model: 'claude-fable-5-1' });
});

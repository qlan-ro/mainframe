/**
 * applyPairing — persist a successful pairing result.
 *
 * Pairing succeeded server-side by the time this runs, so every failure here is
 * LOCAL token storage (the host keyring). It throws rather than swallowing, so
 * the dialog can surface its own `storage` phase instead of reporting "Paired"
 * over a tokenless entry that silently fails the WebSocket auth.
 */
import type { DaemonMeta } from '@qlan-ro/mainframe-types';
import { getHost } from '@/lib/host';
import { parseRemoteUrl } from './pair-daemon';
import type { UseDaemonRegistryResult } from './use-daemon-registry';
import type { DialogMode } from '@/features/daemon/pairing-shared';

export interface ApplyPairingArgs {
  mode: DialogMode;
  target?: DaemonMeta;
  targetUrl: string;
  device: string;
  token: string;
  registry: Pick<UseDaemonRegistryResult, 'add' | 'retoken'>;
}

export async function applyPairing({
  mode,
  target,
  targetUrl,
  device,
  token,
  registry,
}: ApplyPairingArgs): Promise<{ addedId?: string }> {
  if (mode === 'add') {
    const host = parseRemoteUrl(targetUrl).host;
    const label = host.split('.')[0] ?? 'New server';
    const meta: DaemonMeta = {
      id: crypto.randomUUID(),
      kind: 'remote',
      label,
      host,
      device,
      paired: 'Just now',
    };
    await registry.add(meta, token);
    return { addedId: meta.id };
  }

  if (target != null) {
    await getHost().daemons.setToken(target.id, token);
    // Swap the live token in place: the active target holds a snapshot taken
    // when it was selected, so without this the repaired daemon keeps sending
    // the revoked token until the app restarts.
    await registry.retoken(target.id);
  }
  return {};
}

import { useCallback, useEffect, useState } from 'react';
import { getActiveDaemon } from '@/lib/daemon/active-daemon';
import { useActiveBasesStore } from '@/store/active-bases-store';
import { useFilesStore, type VerifiedFileReveal } from '@/store/files';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { useWorkspaceFilesPanel } from '@/store/workspace-files-panel';

function isCurrent(reveal: VerifiedFileReveal): boolean {
  return useActiveBasesStore.getState().tree === reveal.tree && getActiveDaemon().id === reveal.tree.daemonId;
}

export function useFileTreeReveal(port: number, projectId: string, chatId?: string) {
  const activeTree = useActiveBasesStore((s) => s.tree);
  const revealTarget = useFilesStore((s) => s.revealTarget);
  const verifiedReveal = useFilesStore((s) => s.verifiedReveal);
  const [selection, setSelection] = useState<string | VerifiedFileReveal | null>(null);
  const [cached, setCached] = useState<VerifiedFileReveal | null>(null);

  useEffect(() => {
    if (revealTarget === null) return;
    setSelection(revealTarget);
    useFilesStore.getState().consumeRevealTarget();
  }, [revealTarget]);

  useEffect(() => {
    if (!verifiedReveal) return;
    const { tree } = verifiedReveal;
    if (!isCurrent(verifiedReveal) || tree.port !== port || tree.projectId !== projectId || tree.chatId !== chatId)
      return;
    useFilesStore.setState({ verifiedReveal: null });
    setCached((previous) => ({
      ...verifiedReveal,
      listings: new Map([...(previous?.tree === tree ? previous.listings : []), ...verifiedReveal.listings]),
    }));
    setSelection(verifiedReveal);
  }, [verifiedReveal, port, projectId, chatId]);

  const scoped = typeof selection === 'object' && selection?.tree === activeTree ? selection : null;
  const openAndScroll = useCallback(
    (row: HTMLButtonElement) => {
      if (!scoped || !isCurrent(scoped)) return;
      useWorkspaceFilesPanel.getState().setOpen(true);
      const frame = requestAnimationFrame(() => {
        if (row.isConnected && isCurrent(scoped)) row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
      return () => cancelAnimationFrame(frame);
    },
    [scoped],
  );

  const refreshListings = useCallback(() => {
    setCached(null);
    setSelection((current) => (typeof current === 'string' ? current : null));
    const { scopeKey } = useActiveBasesStore.getState();
    if (scoped && scopeKey && isCurrent(scoped)) {
      emitSurfaceIntent({
        type: 'reveal-file',
        path: scoped.path,
        scope: { scopeKey, daemonId: scoped.tree.daemonId },
      });
    }
  }, [scoped]);

  return {
    revealPath: typeof selection === 'string' ? selection : (scoped?.path ?? null),
    listings: cached?.tree === activeTree ? cached.listings : undefined,
    onVerifiedRow: scoped ? openAndScroll : undefined,
    refreshListings,
  };
}

/**
 * Opens a claude.ai artifact inside Mainframe.
 *
 * The local daemon downloads it and a workspace tab shows the result: claude.ai
 * refuses to be framed and has its own login. Anything that can't take that path
 * still reaches the artifact on claude.ai in the browser: a remote daemon, whose
 * machine this webview can't load from, and Docs or Dashboard artifacts, whose
 * content isn't in files. A host with no webview opens the preview as a browser tab.
 */
import { useCallback, useState } from 'react';
import { prepareArtifactPreview } from '@/lib/api/artifacts';
import { apiBase } from '@/lib/api/http';
import { getActiveDaemon } from '@/lib/daemon/active-daemon';
import { useHost } from '@/lib/host';
import { mfToast } from '@/lib/toast';
import { emitSurfaceIntent } from '@/store/surface-intents';

const UNSUPPORTED_NOTE = 'Mainframe can’t show this kind of artifact yet, so it opened on claude.ai.';
const FAILED_NOTE = 'Mainframe couldn’t load this artifact, so it opened on claude.ai.';

export interface OpenArtifact {
  open: (url: string) => Promise<void>;
  opening: boolean;
}

export function useOpenArtifact(): OpenArtifact {
  const host = useHost();
  const [opening, setOpening] = useState(false);

  const openExternal = useCallback(
    (target: string) => {
      host.shell.openExternal(target).catch(() => {
        console.warn('[artifacts] openExternal failed', target);
      });
    },
    [host],
  );

  const showPreview = useCallback(
    async (url: string) => {
      const preview = await prepareArtifactPreview(url);
      if (preview.status !== 'ready') {
        openExternal(url);
        mfToast.info(UNSUPPORTED_NOTE);
        return;
      }
      const target = `${apiBase()}${preview.path}`;
      const platform = await host.app.platform();
      if (platform === 'browser') openExternal(target);
      else emitSurfaceIntent({ type: 'open-url-tab', url: target, title: preview.title });
    },
    [host, openExternal],
  );

  const open = useCallback(
    async (url: string) => {
      if (getActiveDaemon().kind !== 'local') {
        openExternal(url);
        return;
      }
      setOpening(true);
      try {
        await showPreview(url);
      } catch (error) {
        console.warn('[artifacts] preview failed, opening claude.ai', error);
        openExternal(url);
        mfToast.info(FAILED_NOTE);
      } finally {
        setOpening(false);
      }
    },
    [openExternal, showPreview],
  );

  return { open, opening };
}

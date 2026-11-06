/**
 * Moves open workspace tabs to an artifact's newest version after a publish.
 * A preview URL names its version, so retargeting the tab is what reloads it.
 */
import { prepareArtifactPreview } from '@/lib/api/artifacts';
import { apiBase } from '@/lib/api/http';
import { useLayoutStore } from '@/store/layout';
import { artifactSlug } from './artifact-url';

export async function refreshArtifactTabs(url: string): Promise<void> {
  const marker = `/api/artifact-preview/${artifactSlug(url)}/`;
  const tabs = () =>
    (useLayoutStore.getState().run?.panes ?? [])
      .flatMap((pane) => pane.tabs)
      .filter((tab) => tab.kind === 'url' && tab.url?.includes(marker));
  if (tabs().length === 0) return;

  try {
    const preview = await prepareArtifactPreview(url);
    if (preview.status !== 'ready') return;
    const target = `${apiBase()}${preview.path}`;
    for (const tab of tabs()) {
      if (tab.url !== target) useLayoutStore.getState().setUrlTabTarget(tab.id, target, preview.title);
    }
  } catch (error) {
    console.warn('[artifacts] could not refresh open tabs', error);
  }
}

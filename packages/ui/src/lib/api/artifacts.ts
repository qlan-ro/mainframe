import type { ArtifactPreview } from '@qlan-ro/mainframe-types';
import { apiBase, request } from './http';

/** Asks the daemon to download `url`; resolves once it can be shown or won't be. */
export async function prepareArtifactPreview(url: string): Promise<ArtifactPreview> {
  return request<ArtifactPreview>('POST', `${apiBase()}/api/artifacts/preview`, { url });
}

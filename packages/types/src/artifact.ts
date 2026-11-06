/** The daemon's answer to `POST /api/artifacts/preview`. */
export type ArtifactPreview =
  /** Downloaded: `path` is the daemon-relative page to load. */
  | { status: 'ready'; path: string; title: string }
  /** Its content isn't in files (Docs, Dashboard), so only claude.ai can show it. */
  | { status: 'unsupported' };

const ARTIFACT_URL = /^https:\/\/claude\.ai\/artifact\/[A-Za-z0-9_-]+$/;

export function isArtifactUrl(url: string | undefined): url is string {
  return url !== undefined && ARTIFACT_URL.test(url);
}

export function artifactSlug(url: string): string {
  return url.slice(url.lastIndexOf('/') + 1);
}

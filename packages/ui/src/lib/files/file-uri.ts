/**
 * `file://` URI ↔ absolute POSIX path. Paths are percent-encoded per segment,
 * so spaces, `#` and `?` survive the round trip.
 */

const FILE_SCHEME = 'file://';

export function pathToFileUri(absolutePath: string): string {
  return `${FILE_SCHEME}${absolutePath.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * Absolute path of a `file://` URI; anything else passes through unchanged.
 * Decodes without URL parsing, so a literal `#` or `?` stays in the path, and a
 * malformed percent-escape is kept as written instead of throwing.
 */
export function fileUriToPath(uri: string): string {
  if (!uri.startsWith(FILE_SCHEME)) return uri;
  const path = uri.slice(FILE_SCHEME.length).replace(/^localhost(?=\/)/u, '');
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

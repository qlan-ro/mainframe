const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico']);
const BINARY_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, 'pdf']);

export type FileViewerType = 'image' | 'svg' | 'pdf' | 'csv' | 'monaco';

export function getFileExtension(filePath: string): string {
  return filePath.split('.').pop()?.toLowerCase() ?? '';
}

export function getFileViewerType(filePath: string): FileViewerType {
  const ext = getFileExtension(filePath);
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (ext === 'svg') return 'svg';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'csv') return 'csv';
  return 'monaco';
}

export function isBinaryFile(filePath: string): boolean {
  return BINARY_EXTENSIONS.has(getFileExtension(filePath));
}

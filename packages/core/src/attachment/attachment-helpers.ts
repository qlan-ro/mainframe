import type { StoredAttachment } from './attachment-store.js';

export function escapeXmlAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildAttachedFilePathTag(attachment: StoredAttachment): string {
  const name = escapeXmlAttr(attachment.name);
  const mediaType = escapeXmlAttr(attachment.mediaType);
  const sizeBytes = attachment.sizeBytes;
  const resolvedPath = escapeXmlAttr(attachment.materializedPath ?? attachment.originalPath ?? attachment.name);
  return `<attached_file_path name="${name}" path="${resolvedPath}" media_type="${mediaType}" size_bytes="${sizeBytes}" />`;
}

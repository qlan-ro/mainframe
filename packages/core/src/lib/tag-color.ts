import { TAG_PALETTE, type TagColor } from '@qlan-ro/mainframe-types';

/** Stable djb2 hash → palette index. Same name always maps to same color. */
export function hashTagColor(name: string): TagColor {
  let h = 5381;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) + h + name.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(h) % TAG_PALETTE.length;
  return TAG_PALETTE[idx]!;
}

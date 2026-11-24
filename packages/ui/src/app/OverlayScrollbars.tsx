import { useEffect } from 'react';
import { installOverlayScrollbars } from '@/lib/overlay-scrollbars/manager';

/** Mounts the app-wide overlay scrollbar (S3). Renders nothing itself. */
export function OverlayScrollbars() {
  useEffect(() => installOverlayScrollbars(), []);
  return null;
}

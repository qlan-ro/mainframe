/**
 * store/workspace-slide.ts — whether the workspace panel is sliding in or out (W4).
 *
 * A native webview sits above the DOM and is placed by a measured rect, so it
 * cannot ride along: previews stay hidden while this is true, and re-measure
 * when it clears. Transient; `SurfaceHost` is the only writer.
 */
import { create } from 'zustand';

export const useWorkspaceSlide = create<{ sliding: boolean }>(() => ({ sliding: false }));

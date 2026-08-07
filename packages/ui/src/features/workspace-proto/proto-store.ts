/**
 * THROWAWAY PROTOTYPE — remove with features/workspace-proto.
 *
 * One variant cycle for two open decisions (todos #308/#309), mounted across
 * three hosts (MainToolbar, WorkspaceSurface, ChatSurface), so the variant
 * lives in a tiny store rather than component state. Seeded from ?variant=,
 * written back via history.replaceState so a pick is shareable/reload-stable.
 *
 * Enable with ?proto-ws (dev builds only): http://localhost:6173/?proto-ws&variant=B
 */
import { create } from 'zustand';

// Verdict rounds: tabs in title bar + files right in workspace are SETTLED
// (every variant but A shows them). The open question is where the branch
// manager lives once the toolbar's left identity section goes — the project
// name is dropped entirely (Summary panel already names the project's branch
// context; the sidebar names the project).
export const WS_PROTO_VARIANTS = [
  { id: 'A', label: 'A — Today' },
  { id: 'B', label: 'B — Branch in toolbar left (as now)' },
  { id: 'C', label: 'C — Branch → summary panel' },
  { id: 'D', label: 'D — Branch chip → toolbar right' },
] as const;

export type WsProtoVariantId = (typeof WS_PROTO_VARIANTS)[number]['id'];

/**
 * Dev builds only, and only when the URL asks for it. `MODE` is checked
 * alongside `DEV` because an ambient `NODE_ENV=production` in the launching
 * shell makes vite report `DEV:false` from `vite dev` (measured on the
 * session-panel prototype); a real `vite build` still closes the gate.
 */
export function isWorkspaceProtoEnabled(): boolean {
  const dev = import.meta.env.DEV || import.meta.env.MODE === 'development';
  return dev && new URLSearchParams(window.location.search).has('proto-ws');
}

function variantFromUrl(): WsProtoVariantId {
  const v = new URLSearchParams(window.location.search).get('variant');
  return WS_PROTO_VARIANTS.some((entry) => entry.id === v) ? (v as WsProtoVariantId) : 'A';
}

interface WsProtoState {
  variant: WsProtoVariantId;
  cycle: (delta: 1 | -1) => void;
}

export const useWsProto = create<WsProtoState>((set, get) => ({
  variant: variantFromUrl(),
  cycle: (delta) => {
    const ids = WS_PROTO_VARIANTS.map((v) => v.id);
    const next = ids[(ids.indexOf(get().variant) + delta + ids.length) % ids.length]!;
    const url = new URL(window.location.href);
    url.searchParams.set('variant', next);
    window.history.replaceState(null, '', url);
    set({ variant: next });
  },
}));

/** The active variant, or null when the prototype is off — hosts gate on this. */
export function useWsProtoVariant(): WsProtoVariantId | null {
  const variant = useWsProto((s) => s.variant);
  return isWorkspaceProtoEnabled() ? variant : null;
}

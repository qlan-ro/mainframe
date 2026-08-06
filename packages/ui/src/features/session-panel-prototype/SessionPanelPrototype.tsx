/**
 * THROWAWAY PROTOTYPE — three variants of the session panel, switchable via
 * ?variant=, mounted in ChatSurface behind ?proto-panel
 *
 * Delete this directory and its one call site in `ChatSurface.tsx` to remove the
 * whole thing. Nothing here reads real data, writes anything, or persists.
 */
import { useCallback, useState, type ComponentType } from 'react';
import { PrototypeSwitcher } from './PrototypeSwitcher';
import { VariantAClaudeCards } from './VariantAClaudeCards';
import { VariantBFlatSidebar } from './VariantBFlatSidebar';
import { VariantCFloatingPanel } from './VariantCFloatingPanel';
import { useSessionPanelState, type SessionPanelState } from './use-panel-state';
import type { SectionId } from './stub-data';

interface VariantEntry {
  id: string;
  label: string;
  Component: ComponentType<{ state: SessionPanelState }>;
  /** Omitted = every section starts expanded. */
  initialOpenSections?: readonly SectionId[];
}

const VARIANTS: readonly VariantEntry[] = [
  { id: 'A', label: 'A — Claude cards', Component: VariantAClaudeCards },
  { id: 'B', label: 'B — Flat sidebar', Component: VariantBFlatSidebar },
  {
    id: 'C',
    label: 'C — Floating panel',
    Component: VariantCFloatingPanel,
    // Background Activity starts collapsed; the rail's activity icon expands it
    // on click, via selectSection.
    initialOpenSections: ['session', 'context'],
  },
];

function searchParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

/**
 * Dev builds only, and only when the URL asks for it.
 *
 * `MODE` is checked alongside `DEV` because an ambient `NODE_ENV=production` in
 * the launching shell makes vite report `DEV:false` from `vite dev` (measured);
 * `MODE` is still `development` there, and a real `vite build` sets it to
 * `production` regardless of the shell, so the gate stays closed in a shipped app.
 */
export function isSessionPanelPrototypeEnabled(): boolean {
  const dev = import.meta.env.DEV || import.meta.env.MODE === 'development';
  return dev && typeof window !== 'undefined' && searchParams().has('proto-panel');
}

function readVariantIndex(): number {
  const requested = searchParams().get('variant')?.toUpperCase();
  const index = VARIANTS.findIndex((entry) => entry.id === requested);
  return index === -1 ? 0 : index;
}

/**
 * The gate is its own component so the inner one can hold hooks unconditionally
 * — an early return above a `use*` call is what the rules-of-hooks lint is for.
 */
export function SessionPanelPrototype() {
  if (!isSessionPanelPrototypeEnabled()) return null;
  return <SessionPanelPrototypeInner />;
}

function SessionPanelPrototypeInner() {
  const [index, setIndex] = useState(readVariantIndex);

  // The app has no router, so the variant lives in the URL only as a shareable
  // record of what you were looking at — React state is the source of truth.
  const onCycle = useCallback((delta: 1 | -1) => {
    setIndex((current) => {
      const next = (current + delta + VARIANTS.length) % VARIANTS.length;
      const entry = VARIANTS[next];
      if (entry) {
        const params = searchParams();
        params.set('variant', entry.id);
        window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
      }
      return next;
    });
  }, []);

  const entry = VARIANTS[index] ?? VARIANTS[0];
  if (!entry) return null;

  return (
    <>
      {/* Keyed by variant so each one mounts its own state machine: the seed
          below only applies at mount, and comparing variants shouldn't carry
          the previous one's collapsed/floating state across. */}
      <VariantHost key={entry.id} entry={entry} />
      <PrototypeSwitcher label={entry.label} onCycle={onCycle} />
    </>
  );
}

function VariantHost({ entry }: { entry: VariantEntry }) {
  const state = useSessionPanelState({ initialOpenSections: entry.initialOpenSections });
  return <entry.Component state={state} />;
}

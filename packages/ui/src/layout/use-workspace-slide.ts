/**
 * The workspace panel's slide (W4): when it is in the DOM, and which way it is
 * moving. It slides when the user opens or closes it beside the chat. It does
 * not when another session's layout takes over, when the chat is hidden, or
 * under `prefers-reduced-motion`.
 */
import { useCallback, useEffect, useState } from 'react';
import { useWorkspaceSlide as useSlideStore } from '@/store/workspace-slide';

/** Matches the width transition in `SurfaceHost`. */
export const SLIDE_MS = 320;

export type SlidePhase = 'closed' | 'opening' | 'open' | 'closing';

function reducedMotion(): boolean {
  // No matchMedia means no way to ask, so nothing moves.
  return typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface SlideInput {
  lit: boolean;
  /** Both surfaces share the row, before and after: there is a chat to push. */
  beside: boolean;
  sessionId: string | null;
}

function nextPhase(prev: SlideInput & { phase: SlidePhase }, next: SlideInput): SlidePhase {
  if (prev.lit === next.lit) return prev.phase;
  const still = prev.sessionId !== next.sessionId || !prev.beside || !next.beside || reducedMotion();
  if (still) return next.lit ? 'open' : 'closed';
  return next.lit ? 'opening' : 'closing';
}

interface WorkspaceSlide {
  phase: SlidePhase;
  /** Ends an opening slide where it would come to rest: the panel is being resized, and must follow the pointer. */
  settle: () => void;
}

export function useWorkspaceSlide(input: SlideInput): WorkspaceSlide {
  const [state, setState] = useState(() => ({ ...input, phase: (input.lit ? 'open' : 'closed') as SlidePhase }));
  let { phase } = state;
  if (state.lit !== input.lit || state.beside !== input.beside || state.sessionId !== input.sessionId) {
    phase = nextPhase(state, input);
    setState({ ...input, phase });
  }

  const sliding = phase === 'opening' || phase === 'closing';
  useEffect(() => {
    useSlideStore.setState({ sliding });
    if (!sliding) return undefined;
    const timer = setTimeout(() => {
      setState((s) => ({ ...s, phase: s.lit ? 'open' : 'closed' }));
    }, SLIDE_MS);
    return () => clearTimeout(timer);
  }, [sliding, phase]);

  useEffect(() => () => useSlideStore.setState({ sliding: false }), []);

  const settle = useCallback(() => setState((s) => (s.phase === 'opening' ? { ...s, phase: 'open' } : s)), []);
  return { phase, settle };
}

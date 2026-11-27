/**
 * LazyReviewPanel — mounts the review modal only once it has been opened.
 *
 * ReviewPanel pulls in the CodeMirror diff editor (the bulk of the CodeMirror
 * bundle). The modal is closed on every launch, so importing it with the app
 * shell put that code on the boot path for nothing. The chunk is fetched when
 * the browser is idle after the first paint, so the first open rarely waits.
 * The panel stays mounted after the first open so the dialog's close animation
 * and state behave as before.
 *
 * A failed chunk import must not reach the root error boundary: React.lazy
 * caches the rejection, so the modal could never recover and the whole app
 * would be replaced. The local boundary closes the modal, toasts, and rebuilds
 * the lazy component so the next open starts a fresh import.
 */
import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { useOverlaysStore } from '@/store/overlays';
import { mfToast } from '@/lib/toast';

let importPromise: Promise<{ default: typeof import('./ReviewPanel').ReviewPanel }> | undefined;

function loadReviewPanel() {
  importPromise ??= import('./ReviewPanel')
    .then((m) => ({ default: m.ReviewPanel }))
    .catch((err: unknown) => {
      importPromise = undefined;
      throw err;
    });
  return importPromise;
}

let ReviewPanel = lazy(loadReviewPanel);

interface BoundaryProps {
  children: ReactNode;
  onFailed: () => void;
}

class ChunkLoadBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('[LazyReviewPanel] review panel failed to load', error);
    importPromise = undefined;
    ReviewPanel = lazy(loadReviewPanel);
    this.props.onFailed();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function prefetchWhenIdle(): () => void {
  const run = () => void loadReviewPanel().catch(() => undefined);
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(run, { timeout: 3000 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(run, 2000);
  return () => clearTimeout(id);
}

export function LazyReviewPanel() {
  // The compiler would cache the `<ReviewPanel />` element; the binding is
  // reassigned after a failed import, so it must be read on every render.
  'use no memo';
  const reviewOpen = useOverlaysStore((s) => s.reviewOpen);
  const [opened, setOpened] = useState(reviewOpen);
  const [attempt, setAttempt] = useState(0);
  if (reviewOpen && !opened) setOpened(true);

  useEffect(() => prefetchWhenIdle(), []);

  if (!opened) return null;
  return (
    <ChunkLoadBoundary
      key={attempt}
      onFailed={() => {
        setAttempt((n) => n + 1);
        useOverlaysStore.getState().setReviewOpen(false);
        setOpened(false);
        mfToast.error('Could not load the review panel. Try again.');
      }}
    >
      <Suspense fallback={null}>
        <ReviewPanel />
      </Suspense>
    </ChunkLoadBoundary>
  );
}

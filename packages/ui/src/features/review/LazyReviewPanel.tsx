/**
 * LazyReviewPanel — mounts the review modal only once it has been opened.
 *
 * ReviewPanel pulls in the CodeMirror diff editor (the bulk of the CodeMirror
 * bundle). The modal is closed on every launch, so importing it with the app
 * shell put that code on the boot path for nothing. Keep it mounted after the
 * first open so the dialog's close animation and state behave as before.
 */
import { lazy, Suspense, useState } from 'react';
import { useOverlaysStore } from '@/store/overlays';

const ReviewPanel = lazy(() => import('./ReviewPanel').then((m) => ({ default: m.ReviewPanel })));

export function LazyReviewPanel() {
  const reviewOpen = useOverlaysStore((s) => s.reviewOpen);
  const [opened, setOpened] = useState(reviewOpen);
  if (reviewOpen && !opened) setOpened(true);
  if (!opened) return null;
  return (
    <Suspense fallback={null}>
      <ReviewPanel />
    </Suspense>
  );
}

/**
 * ChatEmptyState — the draft/first-run branch selector rendered by ChatSurface.
 * `welcome` shows the project + suggestions column (composer intact via
 * ChatThread; the project may still be unpicked — the welcome screen owns the
 * picker); `firstrun` shows the zero-projects hero (no composer).
 */
import { WelcomeState } from './WelcomeState';
import { FirstRunState } from './FirstRunState';

export function ChatEmptyState({ variant, projectId }: { variant: 'welcome' | 'firstrun'; projectId?: string }) {
  if (variant === 'firstrun') return <FirstRunState />;
  return <WelcomeState projectId={projectId} />;
}

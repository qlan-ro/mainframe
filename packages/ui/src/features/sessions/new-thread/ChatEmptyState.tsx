/**
 * ChatEmptyState — the draft/first-run branch selector rendered by ChatSurface.
 * `welcome` is a new session's empty state above its composer (the project may
 * still be unpicked); `firstrun` shows the zero-projects hero (no composer).
 */
import { FirstRunState } from './FirstRunState';
import { NewSessionState } from './NewSessionState';

export function ChatEmptyState({ variant }: { variant: 'welcome' | 'firstrun' }) {
  return variant === 'firstrun' ? <FirstRunState /> : <NewSessionState />;
}

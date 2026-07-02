/**
 * ChatEmptyState — the message-column content shown before a chat has any
 * messages. Selected by variant:
 *
 *  - 'firstrun': zero projects exist yet (nowhere to send a message).
 *  - 'welcome': a brand-new draft thread with a resolved project, shown
 *    inline above the composer (real ChatThread stays mounted).
 *
 * STUB — real content (copy, illustration, project/adapter affordances)
 * lands in Tasks 11-13. This keeps ChatSurface compiling and testable now.
 */
export function ChatEmptyState({
  variant,
  projectId: _projectId,
}: {
  variant: 'welcome' | 'firstrun';
  projectId?: string;
}) {
  return <div data-testid={`sessions-${variant}-stub`} />;
}

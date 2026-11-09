/**
 * Keeps open artifact previews current. The daemon announces every publish, from
 * any chat or subagent, so a preview follows changes made by a delegated or
 * background agent, not only ones from the chat on screen.
 */
import { daemonWs } from '@/lib/daemon/ws-client';
import { isArtifactUrl } from './artifact-url';
import { refreshArtifactTabs } from './refresh-artifact-tabs';

/** Register the single always-on `artifact.published` subscriber. Mount once at the app root. */
export function installArtifactPublishSubscriber(): () => void {
  return daemonWs.onEvent((event) => {
    if (event.type !== 'artifact.published' || !isArtifactUrl(event.url)) return;
    void refreshArtifactTabs(event.url);
  });
}

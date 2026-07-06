/**
 * resetDaemonScopedStores — clears all daemon-scoped zustand singletons.
 *
 * Zustand stores are module singletons that survive a React remount. When the
 * active daemon switches, in-memory state seeded by daemon A (chat ids, unread
 * markers, process statuses, provider configs, etc.) would bleed into daemon B
 * unless explicitly cleared. This function resets each daemon-scoped store to
 * its documented initial state, mirroring what a fresh page-load would produce
 * for that daemon.
 *
 * Call order in switchTo: AFTER setActiveDaemon(t) (so persisted stores re-key
 * under the new daemon id) and BEFORE the reconnect step.
 *
 * Do NOT add global / daemon-agnostic stores here:
 *   ui-prefs, tutorial, theme, tabs, editor, overlays.
 */
import { GENERAL_DEFAULTS } from '@qlan-ro/mainframe-types';
import { useSessionTodosStore } from '@/store/session-todos';
import { useUnreadStore } from '@/store/unread-store';
import { useActiveBasesStore } from '@/store/active-bases-store';
import { useSandboxStore } from '@/store/sandbox';
import { useSettingsStore } from '@/store/settings';
import { useSessionFilters } from '@/store/session-filters';

export function resetDaemonScopedStores(): void {
  useSessionTodosStore.setState({ byChat: {} });

  useUnreadStore.setState({ unread: new Set<string>() });

  useActiveBasesStore.setState({ bases: {}, scopeKey: null });

  useSandboxStore.setState({
    captures: [],
    processStatuses: {},
    logsOutput: [],
    selectedConfigByScope: {},
    lastStartedProcess: null,
  });

  // settings will refetch from the new daemon on reconnect; set loading=true so
  // the UI shows a loading state rather than stale provider data.
  useSettingsStore.setState({
    providers: {},
    selectedProvider: null,
    general: structuredClone(GENERAL_DEFAULTS),
    loading: true,
  });

  useSessionFilters.setState({
    filterProjectId: null,
    selectedTags: new Set<string>(),
    selectedSynthetic: new Set(),
  });
}

/**
 * NavRail — the 56px column under the title bar, left of the content card.
 * It owns WHICH list the sidebar shows (`sidebarView` in ui-prefs): Chats,
 * Tasks, Automations, Setup Advisor, Settings — all five are view buttons
 * with the same selected/aria-pressed treatment; picking one shows that
 * view's list in the sidebar and its content in the body (D1). The bottom
 * cluster is now just the app's ambient chrome that ISN'T a view: the
 * updater (null while idle) and appearance.
 *
 * Not `SidebarRail`, which is the sidebar primitive's resize handle.
 */
import { MessageSquare, Moon, ScanSearch, Settings, SquareKanban, Sun, Zap } from 'lucide-react';
import { useTheme } from '@/store/theme';
import { useUiPrefs, type SidebarView } from '@/store/ui-prefs';
import { chordHint } from '@/features/shortcuts/chord-hint';
import { selectPendingInteractionCount, useAutomationsStore } from '@/features/automations/data/use-automations-store';
import { NavRailButton } from './NavRailButton';
import { RailUpdateButton } from './RailUpdateButton';

interface ViewDef {
  id: SidebarView;
  label: string;
  icon: typeof MessageSquare;
  /** First-run tour anchor; the Tasks/Automations steps point at the rail now. */
  tut?: string;
}

const VIEWS: readonly ViewDef[] = [
  { id: 'chats', label: 'Chats', icon: MessageSquare },
  { id: 'tasks', label: 'Tasks', icon: SquareKanban, tut: 'kanban' },
  { id: 'automations', label: 'Automations', icon: Zap, tut: 'automations' },
  { id: 'advisor', label: 'Setup Advisor', icon: ScanSearch },
];

export function NavRail() {
  const view = useUiPrefs((s) => s.sidebarView);
  const setView = useUiPrefs((s) => s.setSidebarView);
  const setSidebarVisible = useUiPrefs((s) => s.setSidebarVisible);
  const pendingAutomations = useAutomationsStore(selectPendingInteractionCount);
  const resolvedMode = useTheme((s) => s.resolvedMode);
  const toggleTheme = useTheme((s) => s.toggle);
  const settingsChord = chordHint('app.settings');
  const isDark = resolvedMode === 'dark';

  // Picking a view also shows the sidebar: a collapsed sidebar has nowhere to
  // render the list the click just asked for.
  const select = (id: SidebarView) => {
    setView(id);
    setSidebarVisible(true);
  };

  return (
    <nav data-testid="shell-rail" aria-label="Views" className="flex w-14 shrink-0 flex-col items-center py-2">
      <div className="flex flex-col items-center gap-1">
        {VIEWS.map(({ id, label, icon, tut }) => (
          <NavRailButton
            key={id}
            testId={`shell-rail-${id}`}
            data-tut={tut}
            label={label}
            icon={icon}
            selected={view === id}
            dot={id === 'automations' && pendingAutomations > 0}
            dotTestId={id === 'automations' ? 'shell-rail-automations-pending' : undefined}
            onClick={() => select(id)}
          />
        ))}
      </div>
      <div className="flex-1" />
      <div className="flex flex-col items-center gap-1">
        <RailUpdateButton />
        <NavRailButton
          testId="shell-rail-appearance"
          label={isDark ? 'Switch to light' : 'Switch to dark'}
          icon={isDark ? Sun : Moon}
          onClick={toggleTheme}
        />
        <NavRailButton
          testId="shell-rail-settings"
          label={settingsChord == null ? 'Settings' : `Settings · ${settingsChord}`}
          icon={Settings}
          selected={view === 'settings'}
          onClick={() => select('settings')}
        />
      </div>
    </nav>
  );
}

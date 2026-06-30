import type { LucideIcon } from 'lucide-react';
import { FileText, Wand2, Bot } from 'lucide-react';
import { useUiPrefs, type BottomPanelTab } from '@/store/ui-prefs';
import { useSessionContext } from './use-session-context';
import { useSidebarSkills } from './use-sidebar-skills';
import { sessionItemCount } from './derive-session-items';
import { ContextInspector } from './ContextInspector';
import { SkillsList } from './SkillsList';
import { AgentsList } from './AgentsList';

/** The bottom sidebar panel: Context / Skills / Agents tab bar + active body. */
export function BottomPanel() {
  const tab = useUiPrefs((s) => s.bottomPanelTab);
  const height = useUiPrefs((s) => s.bottomPanelHeight);
  const setTab = useUiPrefs((s) => s.setBottomPanelTab);
  const { context } = useSessionContext();
  const { skills, agents } = useSidebarSkills();

  const contextCount = context
    ? context.globalFiles.length + context.projectFiles.length + sessionItemCount(context)
    : 0;

  const tabs: { id: BottomPanelTab; label: string; icon: LucideIcon; count: number }[] = [
    { id: 'context', label: 'Context', icon: FileText, count: contextCount },
    { id: 'skills', label: 'Skills', icon: Wand2, count: skills.length },
    { id: 'agents', label: 'Agents', icon: Bot, count: agents.length },
  ];

  return (
    <div className="flex shrink-0 flex-col" style={{ height }}>
      <div className="flex shrink-0 items-center gap-0.5 px-2 py-1">
        {tabs.map((t) => {
          const active = tab === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              data-testid={`sidebar-bottom-tab-${t.id}`}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-[5px] rounded-md px-[9px] py-1 text-caption ${
                active
                  ? 'bg-mf-tab-active font-semibold text-foreground shadow-[var(--mf-shadow-rail-active)]'
                  : 'font-medium text-mf-text-2 hover:bg-mf-hover'
              }`}
            >
              <Icon size={11} className={active ? 'text-primary' : 'text-mf-text-2'} aria-hidden />
              <span>{t.label}</span>
              <span className="rounded-full bg-mf-hover px-1.5 text-micro text-mf-text-3">{t.count}</span>
            </button>
          );
        })}
      </div>
      <div className="mf-thin-scrollbar min-h-0 flex-1 overflow-y-auto py-1">
        {tab === 'context' && <ContextInspector />}
        {tab === 'skills' && <SkillsList />}
        {tab === 'agents' && <AgentsList />}
      </div>
    </div>
  );
}

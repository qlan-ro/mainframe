import { Zap } from 'lucide-react';
import { useUiPrefs } from '@/store/ui-prefs';
import { useSettingsStore } from '@/store/settings';
import { GearGlyph, SidebarLeftGlyph, TasksGlyph } from './surface-icons';
import { Hint } from '@/components/ui/hint';
import { useWorkflowsStore, selectPendingCount } from '@/features/workflows/use-workflows-store';

export const TRAFFIC_LIGHTS_SPACER_WIDTH = 80;

/**
 * Spacer that reserves the native macOS traffic-lights zone.
 * Width covers the ~68px cluster (3 × 12px circles + gaps + left inset)
 * so the sidebar header content never overlaps the window controls.
 */
function TrafficLightsSpacer() {
  return <div className="flex-shrink-0" style={{ width: TRAFFIC_LIGHTS_SPACER_WIDTH }} />;
}

function TasksBtn() {
  return (
    <Hint label="Tasks">
      <button
        data-testid="sidebar-tasks-button"
        type="button"
        className="inline-flex h-[24px] w-[28px] cursor-pointer items-center justify-center rounded-[6px] border-none bg-transparent hover:bg-accent"
        onClick={() => window.dispatchEvent(new CustomEvent('mf:open-tasks'))}
      >
        <TasksGlyph size={14} className="text-muted-foreground" />
      </button>
    </Hint>
  );
}

function WorkflowsBtn() {
  const pending = useWorkflowsStore(selectPendingCount);
  return (
    <Hint label="Workflows">
      <button
        data-testid="sidebar-workflows-button"
        type="button"
        className="relative inline-flex h-[24px] w-[28px] cursor-pointer items-center justify-center rounded-[6px] border-none bg-transparent hover:bg-accent"
        onClick={() => window.dispatchEvent(new CustomEvent('mf:open-workflows'))}
      >
        <Zap size={14} className="text-muted-foreground" aria-hidden />
        {pending > 0 && (
          <span
            className="absolute right-[3px] top-[2px] h-[7px] w-[7px] rounded-full bg-mf-warning ring-2 ring-mf-content2"
            aria-hidden
          />
        )}
      </button>
    </Hint>
  );
}

function SettingsBtn() {
  return (
    <Hint label="Settings · ⌘,">
      <button
        data-testid="sidebar-settings-button"
        type="button"
        className="inline-flex h-[22px] w-[26px] cursor-pointer items-center justify-center rounded-[6px] border-none bg-transparent hover:bg-accent"
        onClick={() => useSettingsStore.getState().open()}
      >
        <GearGlyph size={15} className="text-muted-foreground" />
      </button>
    </Hint>
  );
}

function HideSidebarBtn() {
  const toggleSidebar = useUiPrefs((s) => s.toggleSidebar);
  return (
    <Hint label="Hide sidebar">
      <button
        data-testid="sidebar-hide-button"
        type="button"
        className="inline-flex h-[22px] w-[26px] cursor-pointer items-center justify-center rounded-[6px] border-none bg-transparent hover:bg-accent"
        onClick={toggleSidebar}
      >
        <SidebarLeftGlyph size={14} className="text-muted-foreground" />
      </button>
    </Hint>
  );
}

export function SidebarHeader() {
  return (
    <div
      data-testid="sidebar-header"
      data-drag-region
      className="flex h-[38px] flex-shrink-0 items-center gap-[8px] px-[8px]"
    >
      <TrafficLightsSpacer />
      <div className="flex-1" />
      <div className="flex items-center gap-0.5">
        <WorkflowsBtn />
        <TasksBtn />
        <SettingsBtn />
        <span className="mx-px h-[16px] w-px bg-border" />
        <HideSidebarBtn />
      </div>
    </div>
  );
}

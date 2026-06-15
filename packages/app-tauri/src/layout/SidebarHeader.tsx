import { useLayoutStore } from '@/store/layout';
import { useSettingsStore } from '@/store/settings';
import { GearGlyph, SidebarLeftGlyph, TasksGlyph } from './surface-icons';

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
    <button
      data-testid="sidebar-tasks-button"
      type="button"
      title="Tasks"
      className="inline-flex h-6 w-7 cursor-pointer items-center justify-center rounded-[6px] border-none bg-transparent hover:bg-mf-chip"
      onClick={() => window.dispatchEvent(new CustomEvent('mf:open-tasks'))}
    >
      <TasksGlyph size={14} className="text-muted-foreground" />
    </button>
  );
}

function SettingsBtn() {
  return (
    <button
      data-testid="sidebar-settings-button"
      type="button"
      title="Settings · ⌘,"
      className="inline-flex h-[22px] w-[26px] cursor-pointer items-center justify-center rounded-[6px] border-none bg-transparent hover:bg-accent"
      onClick={() => useSettingsStore.getState().open()}
    >
      <GearGlyph size={15} className="text-muted-foreground" />
    </button>
  );
}

function HideSidebarBtn() {
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  return (
    <button
      data-testid="sidebar-hide-button"
      type="button"
      title="Hide sidebar"
      className="inline-flex h-[22px] w-[26px] cursor-pointer items-center justify-center rounded-[6px] border-none bg-transparent hover:bg-accent"
      onClick={toggleSidebar}
    >
      <SidebarLeftGlyph size={14} className="text-muted-foreground" />
    </button>
  );
}

export function SidebarHeader() {
  return (
    <div
      data-testid="sidebar-header"
      data-tauri-drag-region
      className="flex h-[38px] flex-shrink-0 items-center gap-2 px-2"
    >
      <TrafficLightsSpacer />
      <div className="flex-1" />
      <div className="flex items-center gap-0.5">
        <TasksBtn />
        <SettingsBtn />
        <span className="mx-px h-4 w-px bg-border" />
        <HideSidebarBtn />
      </div>
    </div>
  );
}

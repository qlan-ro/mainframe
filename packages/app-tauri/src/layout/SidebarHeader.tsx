import { CheckSquare, PanelLeft, Settings2 } from 'lucide-react';
import { SurfaceRail } from './SurfaceRail';

function TrafficLights() {
  return (
    <div className="flex flex-shrink-0 items-center gap-2 pl-1">
      <span className="size-3 rounded-full bg-[#ff5f57] shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.15)]" />
      <span className="size-3 rounded-full bg-[#febc2e] shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.15)]" />
      <span className="size-3 rounded-full bg-[#28c840] shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.15)]" />
    </div>
  );
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
      <CheckSquare size={14} className="text-muted-foreground" />
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
    >
      <Settings2 size={15} className="text-muted-foreground" />
    </button>
  );
}

function HideSidebarBtn() {
  return (
    <button
      data-testid="sidebar-hide-button"
      type="button"
      title="Hide sidebar"
      className="inline-flex h-[22px] w-[26px] cursor-pointer items-center justify-center rounded-[6px] border-none bg-transparent hover:bg-accent"
    >
      <PanelLeft size={14} className="text-muted-foreground" />
    </button>
  );
}

export function SidebarHeader() {
  return (
    <div
      data-testid="sidebar-header"
      data-tauri-drag-region
      className="flex h-[38px] flex-shrink-0 items-center gap-2 px-2 [border-bottom:0.5px_solid_var(--border)]"
    >
      <TrafficLights />
      <SurfaceRail />
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

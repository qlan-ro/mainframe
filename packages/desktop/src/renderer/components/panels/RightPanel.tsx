import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Minus, PanelLeftOpen } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { ContextTab } from './ContextTab';
import { FilesTab } from './FilesTab';
import { ChangesTab } from './ChangesTab';
import { FileViewHeader } from './FileViewHeader';
import { FileViewContent } from './FileViewContent';
import { useTabsStore } from '../../store/tabs';
import { usePluginLayoutStore, useUIStore } from '../../store';
import { PluginView } from '../plugins/PluginView';

type SidebarTab = 'context' | 'files' | 'changes';

const MIN_SIDEBAR_PX = 240;
const MAX_SIDEBAR_PX = 420;

export function RightPanel(): React.ReactElement {
  const activeRightPanelId = usePluginLayoutStore((s) => s.activeRightPanelId);
  const rightTabContributions = usePluginLayoutStore((s) => s.contributions).filter((c) => c.zone === 'right-tab');

  const togglePanel = useUIStore((s) => s.togglePanel);
  const fileView = useTabsStore((s) => s.fileView);
  const fileViewCollapsed = useTabsStore((s) => s.fileViewCollapsed);
  const toggleFileViewCollapsed = useTabsStore((s) => s.toggleFileViewCollapsed);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('context');
  const revealPath = useTabsStore((s) => s.revealPath);

  // Switch to files tab when reveal is triggered
  useEffect(() => {
    if (revealPath) setSidebarTab('files');
  }, [revealPath]);

  const hasFileView = fileView != null;
  const showFileView = fileView != null && !fileViewCollapsed;

  const sidebarWidth = useTabsStore((s) => s.sidebarWidth);
  const setSidebarWidth = useTabsStore((s) => s.setSidebarWidth);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const prevShowFileView = useRef(showFileView);

  // When the file view first appears, sync sidebarWidth to the container's
  // current width so the tabs area doesn't snap to the default.
  useLayoutEffect(() => {
    if (showFileView && !prevShowFileView.current && containerRef.current) {
      const w = containerRef.current.getBoundingClientRect().width;
      setSidebarWidth(Math.min(MAX_SIDEBAR_PX, Math.max(MIN_SIDEBAR_PX, w)));
    }
    prevShowFileView.current = showFileView;
  }, [showFileView, setSidebarWidth]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const px = rect.right - e.clientX;
    setSidebarWidth(Math.min(MAX_SIDEBAR_PX, Math.max(MIN_SIDEBAR_PX, px)));
  }, []);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  if (activeRightPanelId) {
    return (
      <div className="h-full">
        <PluginView pluginId={activeRightPanelId} />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full flex overflow-hidden">
      {/* File view — conditionally rendered, sidebar stays mounted */}
      {hasFileView && (
        <>
          {showFileView ? (
            <>
              <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                <FileViewHeader />
                <div className="flex-1 overflow-hidden">
                  <FileViewContent />
                </div>
              </div>
              <div
                className="relative w-[5px] shrink-0 cursor-col-resize group"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
              >
                <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-mf-divider group-hover:w-[3px] group-active:bg-mf-divider transition-all" />
              </div>
            </>
          ) : (
            <button
              onClick={toggleFileViewCollapsed}
              className="w-7 shrink-0 flex items-center justify-center border-r border-mf-divider text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-hover transition-colors cursor-pointer"
              title="Expand file view"
              aria-label="Expand file view"
            >
              <PanelLeftOpen size={14} />
            </button>
          )}
        </>
      )}

      {/* Sidebar — always mounted */}
      <div
        data-testid="right-panel"
        className={showFileView ? 'flex flex-col min-w-0 shrink-0' : 'flex flex-col min-w-0 flex-1'}
        style={showFileView ? { width: `${sidebarWidth}px` } : undefined}
      >
        <Tabs value={sidebarTab} onValueChange={(v) => setSidebarTab(v as SidebarTab)} className="h-full flex flex-col">
          <TabsList className="h-11 px-[10px] bg-transparent justify-start gap-1 shrink-0 rounded-none">
            <TabsTrigger value="context" className="text-mf-small">
              Context
            </TabsTrigger>
            <TabsTrigger value="files" className="text-mf-small">
              Files
            </TabsTrigger>
            <TabsTrigger value="changes" className="text-mf-small">
              Changes
            </TabsTrigger>
            {rightTabContributions.map((c) => (
              <TabsTrigger key={c.pluginId} value={`plugin:${c.pluginId}`} className="text-mf-small">
                {c.label}
              </TabsTrigger>
            ))}
            <button
              onClick={() => togglePanel('right')}
              className="ml-auto flex items-center justify-center w-6 h-6 rounded text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-hover transition-colors cursor-pointer"
              title="Collapse right panel"
              aria-label="Collapse right panel"
            >
              <Minus size={14} />
            </button>
          </TabsList>

          <TabsContent value="context" className="flex-1 overflow-y-auto px-[10px] mt-0">
            <ContextTab />
          </TabsContent>

          <TabsContent value="files" className="flex-1 overflow-hidden mt-0 px-[10px]">
            <FilesTab />
          </TabsContent>

          <TabsContent value="changes" className="flex-1 overflow-hidden mt-0">
            <ChangesTab />
          </TabsContent>

          {rightTabContributions.map((c) => (
            <TabsContent key={c.pluginId} value={`plugin:${c.pluginId}`} className="flex-1 overflow-hidden mt-0">
              <PluginView pluginId={c.pluginId} />
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}

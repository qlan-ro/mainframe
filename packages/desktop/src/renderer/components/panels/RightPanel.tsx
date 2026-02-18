import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { PanelLeftOpen, PanelLeftClose } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { ContextTab } from './ContextTab';
import { FilesTab } from './FilesTab';
import { ChangesTab } from './ChangesTab';
import { FileViewHeader } from './FileViewHeader';
import { FileViewContent } from './FileViewContent';
import { useTabsStore } from '../../store/tabs';

type SidebarTab = 'context' | 'files' | 'changes';

const MIN_SIDEBAR_PX = 240;
const MAX_SIDEBAR_PX = 420;

export function RightPanel(): React.ReactElement {
  const fileView = useTabsStore((s) => s.fileView);
  const fileViewCollapsed = useTabsStore((s) => s.fileViewCollapsed);
  const toggleFileViewCollapsed = useTabsStore((s) => s.toggleFileViewCollapsed);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('context');

  const hasFileView = fileView != null;
  const showFileView = fileView != null && !fileViewCollapsed;
  const toggleMode: 'expand' | 'collapse' | undefined =
    fileView == null ? undefined : fileViewCollapsed ? 'expand' : 'collapse';

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

  return (
    <div ref={containerRef} className="h-full flex overflow-hidden">
      {/* File view — conditionally rendered, sidebar stays mounted */}
      {hasFileView && (
        <>
          <div
            className={
              showFileView
                ? 'flex-1 flex flex-col min-w-0 overflow-hidden'
                : 'w-0 min-w-0 overflow-hidden opacity-0 pointer-events-none'
            }
          >
            <FileViewHeader />
            <div className="flex-1 overflow-hidden">
              <FileViewContent />
            </div>
          </div>
          <div
            className={showFileView ? 'relative w-[5px] shrink-0 cursor-col-resize group' : 'w-0 shrink-0'}
            onPointerDown={showFileView ? onPointerDown : undefined}
            onPointerMove={showFileView ? onPointerMove : undefined}
            onPointerUp={showFileView ? onPointerUp : undefined}
          >
            {showFileView && (
              <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-mf-divider group-hover:w-[3px] group-active:bg-mf-divider transition-all" />
            )}
          </div>
        </>
      )}

      {/* Sidebar — always mounted */}
      <div
        className="flex flex-col min-w-0 shrink-0"
        style={showFileView ? { width: `${sidebarWidth}px` } : { width: '100%' }}
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
            {toggleMode && (
              <>
                <div className="flex-1" />
                <button
                  onClick={toggleFileViewCollapsed}
                  className="p-1.5 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-colors"
                  title={toggleMode === 'expand' ? 'Expand file view' : 'Collapse file view'}
                  aria-label={toggleMode === 'expand' ? 'Expand file view' : 'Collapse file view'}
                >
                  {toggleMode === 'expand' ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
                </button>
              </>
            )}
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
        </Tabs>
      </div>
    </div>
  );
}

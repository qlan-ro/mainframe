import React, { useLayoutEffect, useState } from 'react';
import { Panel, Group, Separator, usePanelRef, type Layout } from 'react-resizable-panels';
import { usePluginLayoutStore, useUIStore } from '../store';
import { useTabsStore } from '../store/tabs';
import { TitleBar } from './TitleBar';
import { LeftRail } from './LeftRail';
import { RightRail } from './RightRail';
import { StatusBar } from './StatusBar';
import { PluginView } from './plugins/PluginView';
import { BottomPanel } from './sandbox/BottomPanel';

interface LayoutProps {
  leftPanel: React.ReactNode;
  centerPanel: React.ReactNode;
  rightPanel: React.ReactNode;
}

const RIGHT_PANEL_DEFAULT_PX = 300;

function ResizeHandle(): React.ReactElement {
  return <Separator className="w-mf-gap bg-mf-app-bg hover:bg-mf-divider transition-colors" />;
}

export function Layout({ leftPanel, centerPanel, rightPanel }: LayoutProps): React.ReactElement {
  const { panelCollapsed } = useUIStore();
  const [panelSizes, setPanelSizes] = useState<Layout>({});
  const rightPanelRef = usePanelRef();
  const activeFullviewId = usePluginLayoutStore((s) => s.activeFullviewId);

  const fileView = useTabsStore((s) => s.fileView);
  const fileViewCollapsed = useTabsStore((s) => s.fileViewCollapsed);
  const sidebarWidth = useTabsStore((s) => s.sidebarWidth);
  const hasFileView = fileView != null && !fileViewCollapsed;

  useLayoutEffect(() => {
    if (!rightPanelRef.current || panelCollapsed.right) return;
    const frameId = requestAnimationFrame(() => {
      if (!rightPanelRef.current) return;
      if (hasFileView) {
        rightPanelRef.current.resize('50%');
        return;
      }

      // Shrink to the sidebar's current width (not a hardcoded default)
      // so the panel matches what the user had while the file view was open.
      rightPanelRef.current.resize(Math.max(sidebarWidth, RIGHT_PANEL_DEFAULT_PX));
    });

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [hasFileView, panelCollapsed.right, sidebarWidth]);

  return (
    <div className="h-screen flex flex-col bg-mf-app-bg">
      <TitleBar panelSizes={panelSizes} panelCollapsed={panelCollapsed} />

      <div className="flex-1 flex overflow-hidden gap-0">
        <LeftRail />

        <div className="flex-1 flex flex-col overflow-hidden pb-mf-gap">
          <div className="flex-1 flex overflow-hidden">
            {activeFullviewId ? (
              <div className="flex-1 bg-mf-panel-bg rounded-mf-panel overflow-hidden">
                <PluginView pluginId={activeFullviewId} />
              </div>
            ) : (
              <Group orientation="horizontal" onLayoutChange={setPanelSizes}>
                {/* Left Sidebar */}
                {!panelCollapsed.left && (
                  <>
                    <Panel id="left" defaultSize="22%" minSize="15%" maxSize="35%">
                      <div className="h-full bg-mf-panel-bg rounded-mf-panel overflow-hidden">{leftPanel}</div>
                    </Panel>
                    <ResizeHandle />
                  </>
                )}

                {/* Center Panel */}
                <Panel id="center">
                  <div className="h-full bg-mf-panel-bg rounded-mf-panel overflow-hidden">{centerPanel}</div>
                </Panel>

                {/* Right Panel */}
                {!panelCollapsed.right && (
                  <>
                    <ResizeHandle />
                    <Panel id="right" panelRef={rightPanelRef} defaultSize="22%" minSize="10%" maxSize="70%">
                      <div className="h-full bg-mf-panel-bg rounded-mf-panel overflow-hidden">{rightPanel}</div>
                    </Panel>
                  </>
                )}
              </Group>
            )}
          </div>

          <BottomPanel />
        </div>

        <RightRail />
      </div>

      <StatusBar />
    </div>
  );
}

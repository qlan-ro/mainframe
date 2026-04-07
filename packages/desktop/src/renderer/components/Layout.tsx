import React, { useCallback, useState } from 'react';
import { Panel, Group, Separator } from 'react-resizable-panels';
import { usePluginLayoutStore } from '../store';
import { useLayoutStore } from '../store/layout';
import { TitleBar } from './TitleBar';
import { LeftRail } from './LeftRail';
import { RightRail } from './RightRail';
import { StatusBar } from './StatusBar';
import { PluginView } from './plugins/PluginView';
import { Zone } from './zone/Zone';
import { BottomResizeHandle } from './zone/BottomResizeHandle';

const BOTTOM_HEIGHT_MIN = 120;
const BOTTOM_HEIGHT_DEFAULT = 200;

interface LayoutProps {
  centerPanel: React.ReactNode;
}

function HorizontalResizeHandle(): React.ReactElement {
  return <Separator className="w-mf-gap bg-mf-app-bg hover:bg-mf-divider transition-colors" />;
}

function VerticalResizeHandle(): React.ReactElement {
  return <Separator className="h-mf-gap bg-mf-app-bg hover:bg-mf-divider transition-colors" />;
}

export function Layout({ centerPanel }: LayoutProps): React.ReactElement {
  const activeFullviewId = usePluginLayoutStore((s) => s.activeFullviewId);
  const collapsed = useLayoutStore((s) => s.collapsed);
  const zones = useLayoutStore((s) => s.zones);

  const hasLeftTop = (zones['left-top']?.tabs.length ?? 0) > 0;
  const hasLeftBottom = (zones['left-bottom']?.tabs.length ?? 0) > 0;
  const hasLeft = (hasLeftTop || hasLeftBottom) && !collapsed.left;

  const hasRightTop = (zones['right-top']?.tabs.length ?? 0) > 0;
  const hasRightBottom = (zones['right-bottom']?.tabs.length ?? 0) > 0;
  const hasRight = (hasRightTop || hasRightBottom) && !collapsed.right;

  const hasBottomLeft = (zones['bottom-left']?.tabs.length ?? 0) > 0;
  const hasBottomRight = (zones['bottom-right']?.tabs.length ?? 0) > 0;
  const hasBottom = (hasBottomLeft || hasBottomRight) && !collapsed.bottom;

  const [bottomHeight, setBottomHeight] = useState(BOTTOM_HEIGHT_DEFAULT);

  const handleBottomResize = useCallback((deltaY: number) => {
    setBottomHeight((h) => Math.max(BOTTOM_HEIGHT_MIN, h + deltaY));
  }, []);

  return (
    <div className="h-screen flex flex-col bg-mf-app-bg">
      <TitleBar />

      <div className="flex-1 flex overflow-hidden gap-0">
        <LeftRail />

        <div className="flex-1 flex flex-col overflow-hidden pb-mf-gap">
          {activeFullviewId ? (
            <div className="flex-1 bg-mf-panel-bg rounded-mf-panel overflow-hidden">
              <PluginView pluginId={activeFullviewId} />
            </div>
          ) : (
            <>
              {/* Upper area: horizontal Group with left col + center + right col */}
              <Group orientation="horizontal" className="flex-1">
                {hasLeft && (
                  <>
                    <Panel id="left-column" defaultSize="22%" maxSize="40%">
                      <Group orientation="vertical">
                        {hasLeftTop && (
                          <Panel id="left-top" defaultSize="60%" minSize="20%">
                            <div className="h-full bg-mf-panel-bg rounded-mf-panel overflow-hidden">
                              <Zone id="left-top" />
                            </div>
                          </Panel>
                        )}
                        {hasLeftTop && hasLeftBottom && <VerticalResizeHandle />}
                        {hasLeftBottom && (
                          <Panel id="left-bottom" defaultSize="40%" minSize="20%">
                            <div className="h-full bg-mf-panel-bg rounded-mf-panel overflow-hidden">
                              <Zone id="left-bottom" />
                            </div>
                          </Panel>
                        )}
                      </Group>
                    </Panel>
                    <HorizontalResizeHandle />
                  </>
                )}

                <Panel id="center">
                  <div className="h-full bg-mf-panel-bg rounded-mf-panel overflow-hidden">{centerPanel}</div>
                </Panel>

                {hasRight && (
                  <>
                    <HorizontalResizeHandle />
                    <Panel id="right-column" defaultSize="22%" minSize="10%" maxSize="40%">
                      <Group orientation="vertical">
                        {hasRightTop && (
                          <Panel id="right-top" defaultSize="60%" minSize="20%">
                            <div className="h-full bg-mf-panel-bg rounded-mf-panel overflow-hidden">
                              <Zone id="right-top" />
                            </div>
                          </Panel>
                        )}
                        {hasRightTop && hasRightBottom && <VerticalResizeHandle />}
                        {hasRightBottom && (
                          <Panel id="right-bottom" defaultSize="40%" minSize="20%">
                            <div className="h-full bg-mf-panel-bg rounded-mf-panel overflow-hidden">
                              <Zone id="right-bottom" />
                            </div>
                          </Panel>
                        )}
                      </Group>
                    </Panel>
                  </>
                )}
              </Group>

              {/* Bottom area: full width */}
              {hasBottom && (
                <>
                  <BottomResizeHandle onResize={handleBottomResize} />
                  <div style={{ height: bottomHeight, flexShrink: 0 }}>
                    <Group orientation="horizontal">
                      {hasBottomLeft && (
                        <Panel id="bottom-left" defaultSize="50%" minSize="20%">
                          <div className="h-full bg-mf-panel-bg rounded-mf-panel overflow-hidden">
                            <Zone id="bottom-left" />
                          </div>
                        </Panel>
                      )}
                      {hasBottomLeft && hasBottomRight && <HorizontalResizeHandle />}
                      {hasBottomRight && (
                        <Panel id="bottom-right" defaultSize="50%" minSize="20%">
                          <div className="h-full bg-mf-panel-bg rounded-mf-panel overflow-hidden">
                            <Zone id="bottom-right" />
                          </div>
                        </Panel>
                      )}
                    </Group>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <RightRail />
      </div>

      <StatusBar />
    </div>
  );
}

import React from 'react';
import { Minus } from 'lucide-react';
import { ChatsPanel } from './ChatsPanel';
import { AgentsPanel } from './AgentsPanel';
import { SkillsPanel } from './SkillsPanel';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { usePluginLayoutStore, useUIStore } from '../../store';
import { PluginView } from '../plugins/PluginView';

export function LeftPanel(): React.ReactElement {
  const activeLeftPanelId = usePluginLayoutStore((s) => s.activeLeftPanelId);
  const leftTabContributions = usePluginLayoutStore((s) => s.contributions).filter((c) => c.zone === 'left-tab');
  const togglePanel = useUIStore((s) => s.togglePanel);

  // Full-panel plugin mode — return early
  if (activeLeftPanelId) {
    return <PluginView pluginId={activeLeftPanelId} />;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Tabbed content */}
      <Tabs defaultValue="sessions" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="h-11 px-[10px] bg-transparent justify-start gap-1 shrink-0 rounded-none">
          <TabsTrigger value="sessions" className="text-mf-small">
            Sessions
          </TabsTrigger>
          <TabsTrigger value="skills" className="text-mf-small">
            Skills
          </TabsTrigger>
          <TabsTrigger value="agents" className="text-mf-small">
            Agents
          </TabsTrigger>
          {leftTabContributions.map((c) => (
            <TabsTrigger key={c.pluginId} value={`plugin:${c.pluginId}`} className="text-mf-small">
              {c.label}
            </TabsTrigger>
          ))}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => togglePanel('left')}
                className="ml-auto flex items-center justify-center w-6 h-6 rounded text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-hover transition-colors cursor-pointer"
                aria-label="Collapse left panel"
              >
                <Minus size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Collapse left panel</TooltipContent>
          </Tooltip>
        </TabsList>
        <TabsContent value="sessions" className="flex-1 overflow-hidden mt-0">
          <ChatsPanel />
        </TabsContent>
        <TabsContent value="skills" className="flex-1 overflow-hidden mt-0">
          <SkillsPanel />
        </TabsContent>
        <TabsContent value="agents" className="flex-1 overflow-hidden mt-0">
          <AgentsPanel />
        </TabsContent>
        {leftTabContributions.map((c) => (
          <TabsContent key={c.pluginId} value={`plugin:${c.pluginId}`} className="flex-1 overflow-hidden mt-0">
            <PluginView pluginId={c.pluginId} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

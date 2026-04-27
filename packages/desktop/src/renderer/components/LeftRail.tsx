import React from 'react';
import { Settings, HelpCircle } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { usePluginLayoutStore, useSettingsStore } from '../store';
import { PluginIcon } from './plugins/PluginIcon';
import { RailButton, RailSection } from './zone/RailSection';

export function LeftRail(): React.ReactElement {
  const fullviewContributions = usePluginLayoutStore(
    useShallow((s) => s.contributions.filter((c) => c.zone === 'fullview')),
  );
  const activeFullviewId = usePluginLayoutStore((s) => s.activeFullviewId);

  return (
    <div className="w-11 bg-mf-app-bg flex flex-col items-center py-2 shrink-0">
      {/* Section 1: left-top zone icons */}
      <RailSection zoneId="left-top" />

      {/* Divider between top and mid */}
      <div className="w-5 h-px bg-mf-divider my-2" />

      {/* Section 2: left-bottom zone icons */}
      <RailSection zoneId="left-bottom" />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Section 3: bottom-left zone icons */}
      <RailSection zoneId="bottom-left" />

      {/* Fixed utilities separator */}
      <div className="w-5 h-px bg-mf-divider my-2" />

      {/* Fullview plugin icons */}
      {fullviewContributions.map((c) => (
        <RailButton
          key={c.pluginId}
          active={activeFullviewId === c.pluginId}
          onClick={() => usePluginLayoutStore.getState().activateFullview(c.pluginId)}
          title={c.label}
        >
          {c.icon ? <PluginIcon name={c.icon} size={16} /> : <span className="text-xs">{c.label[0]}</span>}
        </RailButton>
      ))}

      {/* Fixed utility buttons — not part of zone system */}
      <RailButton onClick={() => useSettingsStore.getState().open()} title="Settings">
        <Settings size={16} />
      </RailButton>
      <RailButton onClick={() => useSettingsStore.getState().open(undefined, 'about')} title="Help">
        <HelpCircle size={16} />
      </RailButton>
    </div>
  );
}

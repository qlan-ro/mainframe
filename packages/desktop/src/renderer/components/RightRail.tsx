import React from 'react';
import { RailSection } from './zone/RailSection';

export function RightRail(): React.ReactElement {
  return (
    <div className="w-11 bg-mf-app-bg flex flex-col items-center py-2 shrink-0">
      {/* Section 1: right-top zone icons */}
      <RailSection zoneId="right-top" />

      {/* Divider between top and mid */}
      <div className="w-5 h-px bg-mf-divider my-2" />

      {/* Section 2: right-bottom zone icons */}
      <RailSection zoneId="right-bottom" />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Section 3: bottom-right zone icons */}
      <RailSection zoneId="bottom-right" />
    </div>
  );
}

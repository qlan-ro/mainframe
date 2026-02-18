import React from 'react';
import { Zap } from 'lucide-react';

export function SlashCommandCard({ args }: { args: Record<string, unknown> }) {
  const skill = (args.skill as string) || '';
  const skillArgs = (args.args as string) || '';

  return (
    <div className="flex items-center gap-1.5 py-0.5">
      <Zap size={14} className="text-mf-accent shrink-0" />
      <span className="font-mono text-mf-body text-mf-accent">/{skill}</span>
      {skillArgs && (
        <span className="font-mono text-mf-small text-mf-text-secondary/60 truncate" title={skillArgs}>
          {skillArgs}
        </span>
      )}
    </div>
  );
}

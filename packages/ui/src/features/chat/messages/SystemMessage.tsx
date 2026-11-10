'use client';

import { AlertTriangleIcon, LayersIcon, ZapIcon } from 'lucide-react';
import { MessagePrimitive, useAuiState } from '@assistant-ui/react';
import { cn } from '@/lib/utils';
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker';
import { useMainframeMeta } from '../view-model/message-meta';
import { SkillLoadedCard } from '../tools/cards/SkillLoadedCard';
import { IdleCompactionMarker } from './IdleCompactionMarker';
import { ProviderSwitchMarker } from './ProviderSwitchMarker';

export function CompactionPill() {
  return (
    <Marker variant="separator" data-testid="chat-compaction-pill" className="my-2 select-none">
      <MarkerIcon>
        <LayersIcon />
      </MarkerIcon>
      <MarkerContent>Context compacted</MarkerContent>
    </Marker>
  );
}

const CLI_ERROR_RE = /^Unknown (?:command|skill):/i;

function SystemTextMarker({ text }: { text: string }) {
  const isError = CLI_ERROR_RE.test(text);
  const Icon = isError ? AlertTriangleIcon : ZapIcon;
  return (
    <Marker variant="separator" className={cn('my-1.5 select-none', isError && 'text-destructive')}>
      <MarkerIcon>
        <Icon />
      </MarkerIcon>
      <MarkerContent>{text}</MarkerContent>
    </Marker>
  );
}

export function SystemMessage() {
  const messageId = useAuiState((s) => s.message.id);
  const { isCompacted, compaction, skillLoaded, providerSwitch } = useMainframeMeta();

  let body = (
    <MessagePrimitive.Parts components={{ Text: ({ text }) => (text ? <SystemTextMarker text={text} /> : null) }} />
  );
  if (providerSwitch) body = <ProviderSwitchMarker marker={providerSwitch} />;
  else if (compaction?.origin === 'idle') body = <IdleCompactionMarker messageId={messageId} compaction={compaction} />;
  else if (isCompacted) body = <CompactionPill />;
  else if (skillLoaded) {
    body = <SkillLoadedCard skillName={skillLoaded.skillName} path={skillLoaded.path} content={skillLoaded.content} />;
  }

  return (
    <MessagePrimitive.Root data-testid="chat-system-message" className="py-0.5">
      {body}
    </MessagePrimitive.Root>
  );
}

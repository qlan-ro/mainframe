'use client';

import { AlertTriangleIcon, Minimize2Icon, ZapIcon } from 'lucide-react';
import { MessagePrimitive, useAuiState } from '@assistant-ui/react';
import { cn } from '@/lib/utils';
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker';
import { useMainframeMeta } from '../view-model/message-meta';
import { MarkerBodyView } from '../tools/markers/MarkerBodyView';
import { MarkerPill } from '../tools/markers/MarkerPill';
import type { LoadedSkill } from '../view-model/turn/types';
import { IdleCompactionMarker } from './IdleCompactionMarker';
import { ProviderSwitchMarker } from './ProviderSwitchMarker';

export function CompactionPill() {
  return (
    <Marker variant="separator" data-testid="chat-compaction-pill" className="mf-tr-divider select-none">
      <MarkerIcon className="size-3">
        <Minimize2Icon className="size-3" strokeWidth={1.5} />
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
    <Marker variant="separator" className={cn('my-1.5 select-none', isError && 'text-fail')}>
      <MarkerIcon>
        <Icon />
      </MarkerIcon>
      <MarkerContent>{text}</MarkerContent>
    </Marker>
  );
}

/** A skill the user invoked: no call of the agent's stands for it. */
function SkillMarker({ skill, messageId }: { skill: LoadedSkill; messageId: string }) {
  const lines = skill.content ? skill.content.replace(/\n$/, '').split('\n').length : 0;
  return (
    <MarkerPill
      rowKey={`skill:${messageId}`}
      testId="chat-skill-loaded-pill"
      icon={ZapIcon}
      label="Used skill"
      target={`/${skill.skillName.replace(/^\//, '')}`}
      mono
      receipt={lines ? `${lines} ${lines === 1 ? 'line' : 'lines'}` : undefined}
      hint={skill.path || undefined}
    >
      {skill.content && (
        <MarkerBodyView id={messageId} body={{ type: 'skill', path: skill.path, content: skill.content, args: '' }} />
      )}
    </MarkerPill>
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
    body = <SkillMarker skill={skillLoaded} messageId={messageId} />;
  }

  return (
    <MessagePrimitive.Root data-testid="chat-system-message" className="py-0.5">
      {body}
    </MessagePrimitive.Root>
  );
}

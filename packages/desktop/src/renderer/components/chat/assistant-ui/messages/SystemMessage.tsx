import { AlertTriangle, Zap } from 'lucide-react';
import { MessagePrimitive, useMessage } from '@assistant-ui/react';
import { getExternalStoreMessages } from '@assistant-ui/react';
import { SkillLoadedCard } from '../parts/tools/SkillLoadedCard';
import type { DisplayMessage, DisplayContent } from '@qlan-ro/mainframe-types';

const CLI_ERROR_PREFIXES = [/^Unknown command:/];

function isCliError(text: string): boolean {
  return CLI_ERROR_PREFIXES.some((re) => re.test(text));
}

export function SystemMessage() {
  const message = useMessage();
  const [original] = getExternalStoreMessages<DisplayMessage>(message);

  const skillBlock = original?.content?.find(
    (c): c is DisplayContent & { type: 'skill_loaded' } => c.type === 'skill_loaded',
  );
  if (skillBlock) {
    return (
      <MessagePrimitive.Root>
        <SkillLoadedCard skillName={skillBlock.skillName} path={skillBlock.path} content={skillBlock.content} />
      </MessagePrimitive.Root>
    );
  }

  const textPart = message.content.find((p): p is { type: 'text'; text: string } => p.type === 'text');
  if (!textPart) return null;
  const isError = isCliError(textPart.text);
  const Icon = isError ? AlertTriangle : Zap;
  const pillClass = isError ? 'bg-red-500/15' : 'bg-mf-hover/50';
  const textClass = isError ? 'text-red-400' : 'text-mf-text-secondary';
  return (
    <MessagePrimitive.Root className="flex justify-center">
      <div className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 ${pillClass}`}>
        <Icon size={12} className={textClass} />
        <span className={`font-mono text-[11px] ${textClass}`}>{textPart.text}</span>
      </div>
    </MessagePrimitive.Root>
  );
}

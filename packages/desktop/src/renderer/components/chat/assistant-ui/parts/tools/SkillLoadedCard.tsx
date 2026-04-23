import React from 'react';
import { Zap } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CollapsibleToolCard } from './CollapsibleToolCard';
import { Tooltip, TooltipTrigger, TooltipContent } from '../../../../ui/tooltip';

interface SkillLoadedCardProps {
  skillName: string;
  path: string;
  content: string;
}

function SkillHeader({ skillName, path }: { skillName: string; path: string }) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <Zap size={14} className="text-mf-accent shrink-0" />
      <span className="font-mono text-mf-body text-mf-accent">/{skillName}</span>
      {path && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="font-mono text-mf-small text-mf-text-secondary/60 truncate max-w-[300px]" tabIndex={0}>
              {path}
            </span>
          </TooltipTrigger>
          <TooltipContent>{path}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

export function SkillLoadedCard({ skillName, path, content }: SkillLoadedCardProps) {
  return (
    <CollapsibleToolCard defaultOpen={false} header={<SkillHeader skillName={skillName} path={path} />}>
      <div className="max-h-[480px] overflow-y-auto px-3 pb-3 pt-1">
        {/* react-markdown dropped its className prop in v9; wrap the output instead. */}
        <div className="prose prose-sm dark:prose-invert max-w-none text-mf-text-primary text-mf-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      </div>
    </CollapsibleToolCard>
  );
}

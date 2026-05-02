import { ChevronDown, ChevronRight, Zap } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Tooltip, TooltipTrigger, TooltipContent } from '../../../../ui/tooltip';
import { markdownComponents } from '../markdown-text';
import { urlTransform } from '../../../../../lib/markdown-url-transform';
import { useExpandable } from './use-expandable';

interface SkillLoadedCardProps {
  skillName: string;
  path: string;
  content: string;
}

// Pill-style collapsible for skill invocations. Intentionally rolls its own
// layout instead of using CollapsibleToolCard because:
//   - the pill is centered + rounded-full, not a full-width row
//   - the expanded body is visually detached (markdown panel below the pill)
//   - changing CollapsibleToolCard's button styling would regress every other
//     tool card that uses it
export function SkillLoadedCard({ skillName, path, content }: SkillLoadedCardProps) {
  const { open, toggle, ref } = useExpandable<HTMLDivElement>();
  const Chevron = open ? ChevronDown : ChevronRight;

  const pill = (
    <button
      type="button"
      onClick={() => toggle()}
      className="inline-flex items-center gap-1.5 rounded-full bg-mf-hover/50 px-3 py-1 hover:bg-mf-hover/70 transition-colors"
      aria-expanded={open}
    >
      <Zap size={12} className="text-mf-text-secondary shrink-0" />
      <span className="font-mono text-[11px] text-mf-text-secondary">
        Using skill: <span className="text-mf-accent">{skillName}</span>
      </span>
      <Chevron size={12} className="text-mf-text-secondary/60 shrink-0" />
    </button>
  );

  return (
    <div ref={ref} className="flex flex-col items-center gap-2 my-2">
      {path ? (
        <Tooltip>
          <TooltipTrigger asChild>{pill}</TooltipTrigger>
          <TooltipContent>{path}</TooltipContent>
        </Tooltip>
      ) : (
        pill
      )}
      {open && (
        <div className="w-full max-h-[480px] overflow-y-auto rounded-mf-card border border-mf-divider bg-mf-hover/20 px-3 py-2">
          <div className="aui-md text-mf-text-primary">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={markdownComponents as Parameters<typeof ReactMarkdown>[0]['components']}
              urlTransform={urlTransform}
            >
              {content}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

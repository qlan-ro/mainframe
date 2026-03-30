import { FileText } from 'lucide-react';
import { useTabsStore } from '../../store/tabs';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';

interface ContextFileItemProps {
  path: string;
  displayName?: string;
  badge?: string;
}

export function ContextFileItem({ path, displayName, badge }: ContextFileItemProps) {
  const fileName = displayName ?? path.split('/').pop() ?? path;
  const openEditorTab = useTabsStore((s) => s.openEditorTab);

  const handleClick = () => {
    openEditorTab(path);
  };

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-2 px-2 py-1 rounded-mf-input hover:bg-mf-hover cursor-pointer text-mf-small text-mf-text-primary w-full text-left"
    >
      <FileText size={14} className="text-mf-text-secondary shrink-0" />
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="truncate" tabIndex={0}>
            {fileName}
          </span>
        </TooltipTrigger>
        <TooltipContent>{path}</TooltipContent>
      </Tooltip>
      {badge && (
        <span className="text-mf-status text-mf-text-secondary bg-mf-hover rounded-full px-1.5 shrink-0">{badge}</span>
      )}
    </button>
  );
}

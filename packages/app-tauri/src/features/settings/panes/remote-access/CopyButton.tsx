import { useState, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

interface CopyButtonProps {
  text: string;
  testId?: string;
}

export function CopyButton({ text, testId }: CopyButtonProps): React.ReactElement {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* expected — clipboard may not be available in all contexts */
    }
  }, [text]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          data-testid={testId}
          onClick={handleCopy}
          className="p-1 text-mf-text-tertiary hover:text-mf-text-primary transition-colors shrink-0"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </TooltipTrigger>
      <TooltipContent>Copy</TooltipContent>
    </Tooltip>
  );
}

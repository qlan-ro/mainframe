import { useState, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from '@v2/components/ui/button';
import { Hint } from '@v2/components/ui/hint';

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
    } catch (err) {
      /* expected — clipboard may not be available in all contexts */
      console.warn('[settings/CopyButton] clipboard write failed', err);
    }
  }, [text]);

  return (
    <Hint label="Copy">
      <Button
        variant="ghost"
        size="icon-sm"
        data-testid={testId}
        onClick={handleCopy}
        aria-label="Copy"
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </Hint>
  );
}

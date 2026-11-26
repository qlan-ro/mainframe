import { useState } from 'react';
import { DownloadIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { downloadMarkdown } from '@/features/chat/messages/transcript-markdown';

export function ConversationExportButton({
  label,
  testId,
  load,
  name,
}: {
  label: string;
  testId: string;
  load: () => Promise<string>;
  name: string;
}) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      downloadMarkdown(await load(), name);
    } catch {
      toast.error('Could not export the transcript');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      title={label}
      aria-label={label}
      data-testid={testId}
      disabled={busy}
      onClick={() => void run()}
    >
      <DownloadIcon />
    </Button>
  );
}

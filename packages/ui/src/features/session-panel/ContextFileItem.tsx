/**
 * ContextFileItem — a file row in Mentioned files or Skills: basename (or
 * display name), a word at the end saying why the file is here, and the full
 * path in a Hint.
 */
import { FileText } from 'lucide-react';
import { Hint } from '@/components/ui/hint';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { PanelRow } from './PanelSection';

interface ContextFileItemProps {
  path: string;
  displayName?: string;
  reason?: string;
  testId?: string;
}

export function ContextFileItem({ path, displayName, reason, testId }: ContextFileItemProps) {
  return (
    <Hint label={path}>
      <PanelRow
        data-testid={testId ?? `session-panel-session-item-${path}`}
        aria-label={reason ? `${path}, ${reason}` : path}
        onClick={() => emitSurfaceIntent({ type: 'open-file', path })}
        icon={<FileText />}
        label={displayName ?? path.split('/').pop() ?? path}
        value={reason}
      />
    </Hint>
  );
}

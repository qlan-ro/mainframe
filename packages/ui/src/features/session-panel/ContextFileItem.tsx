/**
 * ContextFileItem — one in-session file mention in the Context section's Session
 * sub-group: basename (or display name), a badge naming why the file is in
 * context (`@` · auto · plan · skill), and the full path in a Hint.
 *
 * Moved out of the retired bottom context panel with the Session sub-group it
 * feeds. Its v1 chrome came with it and was ported here: the hand-rolled badge
 * is the v2 `Badge` primitive, matching the scope chips its sibling rows render,
 * and the outline nesting it used to indent for died with that panel.
 */
import { FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Hint } from '@/components/ui/hint';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { SUB_GROUP_ROW } from './PanelSubGroup';

interface ContextFileItemProps {
  path: string;
  displayName?: string;
  badge?: string;
  testId?: string;
}

export function ContextFileItem({ path, displayName, badge, testId }: ContextFileItemProps) {
  const fileName = displayName ?? path.split('/').pop() ?? path;
  return (
    <Hint label={path}>
      <button
        type="button"
        data-testid={testId ?? `session-panel-session-item-${path}`}
        aria-label={path}
        onClick={() => emitSurfaceIntent({ type: 'open-file', path })}
        className={SUB_GROUP_ROW}
      >
        <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm">{fileName}</span>
        {badge && <Badge variant="outline">{badge}</Badge>}
      </button>
    </Hint>
  );
}

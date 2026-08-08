/**
 * ContextSection — what the agent is working from: the memory files it loaded,
 * the files this session touched, the skills it invoked, and the session's
 * attachments.
 *
 * Every sub-group reads the SAME source, the session context. Skills lists the
 * skills THIS session invoked (`skillFiles`), not the adapter's available-skills
 * catalog — that catalog belongs to the Setup Advisor, which Manage reaches. It
 * is the only route to that sheet, so the sub-group renders even when empty.
 */
import { Layers } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { useSessionContext } from '@/features/sessions/use-session-context';
import { useSetupAdvisor } from '@/features/setup-advisor/use-setup-advisor';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { ContextFileItem } from './ContextFileItem';
import { deriveContextFiles, type ContextFileRow } from './context-groups';
import { deriveSessionItems } from './derive-session-items';
import { formatTokens } from './context-tokens';
import { PanelAttachmentsGrid } from './PanelAttachmentsGrid';
import { PanelSection } from './PanelSection';
import { PanelSubGroup, SUB_GROUP_ROW } from './PanelSubGroup';

const SUB_NOTE = 'px-1 py-0.5 text-xs text-muted-foreground';

function MemoryFileRow({ row }: { row: ContextFileRow }) {
  return (
    <Hint label={row.path}>
      <button
        type="button"
        data-testid={`session-panel-context-file-${row.path}`}
        onClick={() => emitSurfaceIntent({ type: 'open-file', path: row.path })}
        className={SUB_GROUP_ROW}
      >
        <span className="min-w-0 flex-1 truncate text-sm">{row.label}</span>
        <Badge variant="outline">{row.scope}</Badge>
        {/* A token count is one of the reserved mono cases; the tilde marks it an estimate. */}
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {formatTokens(row.tokens)}
        </span>
      </button>
    </Hint>
  );
}

interface ContextSectionProps {
  port: number;
  open: boolean;
  onToggle: () => void;
  sectionRef?: (el: HTMLElement | null) => void;
}

export function ContextSection({ port, open, onToggle, sectionRef }: ContextSectionProps) {
  const { context, chatId } = useSessionContext();
  const openSheet = useSetupAdvisor((s) => s.openSheet);

  const memoryFiles = deriveContextFiles(context);
  const sessionItems = context ? deriveSessionItems(context) : [];
  const skillFiles = context?.skillFiles ?? [];
  const attachments = context?.attachments ?? [];
  const count = memoryFiles.length + sessionItems.length + skillFiles.length + attachments.length;

  return (
    <PanelSection
      id="context"
      label="Context"
      icon={Layers}
      count={count > 0 ? count : undefined}
      open={open}
      onToggle={onToggle}
      sectionRef={sectionRef}
    >
      {memoryFiles.length > 0 && (
        <PanelSubGroup label="Context" count={memoryFiles.length}>
          {memoryFiles.map((row) => (
            <MemoryFileRow key={row.path} row={row} />
          ))}
        </PanelSubGroup>
      )}

      {sessionItems.length > 0 && (
        <PanelSubGroup label="Session" count={sessionItems.length}>
          {sessionItems.map((item) => (
            <ContextFileItem
              key={item.path}
              testId={`session-panel-session-item-${item.path}`}
              path={item.path}
              badge={item.badge}
            />
          ))}
        </PanelSubGroup>
      )}

      <PanelSubGroup
        label="Skills"
        count={skillFiles.length}
        action={
          <Button
            data-testid="session-panel-skills-manage"
            variant="link"
            size="xs"
            onClick={() => openSheet('skills')}
          >
            Manage
          </Button>
        }
      >
        {skillFiles.length === 0 ? (
          <div data-testid="session-panel-skills-empty" className={SUB_NOTE}>
            No skills used
          </div>
        ) : (
          skillFiles.map((f) => (
            <ContextFileItem
              key={f.path}
              testId={`session-panel-skill-${f.path}`}
              path={f.path}
              displayName={f.displayName}
            />
          ))
        )}
      </PanelSubGroup>

      {attachments.length > 0 && chatId != null && (
        <PanelSubGroup label="Attachments" count={attachments.length}>
          <PanelAttachmentsGrid port={port} chatId={chatId} attachments={attachments} enabled={open} />
        </PanelSubGroup>
      )}
    </PanelSection>
  );
}

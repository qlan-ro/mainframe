/**
 * ContextSection — what the agent is working from, as FOUR first-class panel
 * sections (no "Context" wrapper, no sub-groups): Memory files it loaded,
 * Mentioned files this session touched, Skills it invoked, and the session's
 * Attachments. Empty ones hide, except Skills.
 *
 * Every section reads the SAME source, the session context. Skills lists the
 * skills THIS session invoked (`skillFiles`), not the adapter's available-skills
 * catalog — that catalog belongs to the Setup Advisor, which Manage reaches. It
 * is the only route to that sheet, so the Skills section renders even when empty.
 */
import type { ReactNode } from 'react';
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
import { PANEL_EMPTY, PANEL_ROW_BUTTON, PanelEyebrow, SECTION_BODY } from './PanelEyebrow';

function MemoryFileRow({ row }: { row: ContextFileRow }) {
  return (
    <Hint label={row.path}>
      <button
        type="button"
        data-testid={`session-panel-context-file-${row.path}`}
        onClick={() => emitSurfaceIntent({ type: 'open-file', path: row.path })}
        className={PANEL_ROW_BUTTON}
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
}

/** One first-class panel section: the shared eyebrow over a body of rows. */
function Section({
  id,
  label,
  action,
  children,
}: {
  id: string;
  label: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section data-testid={`session-panel-section-${id}`} className="shrink-0">
      <PanelEyebrow label={label} action={action} />
      <div className={SECTION_BODY}>{children}</div>
    </section>
  );
}

export function ContextSection({ port }: ContextSectionProps) {
  const { context, chatId } = useSessionContext();
  const openSheet = useSetupAdvisor((s) => s.openSheet);

  const memoryFiles = deriveContextFiles(context);
  const sessionItems = context ? deriveSessionItems(context) : [];
  const skillFiles = context?.skillFiles ?? [];
  const attachments = context?.attachments ?? [];

  return (
    <>
      {memoryFiles.length > 0 && (
        <Section id="memory" label="Memory files">
          {memoryFiles.map((row) => (
            <MemoryFileRow key={row.path} row={row} />
          ))}
        </Section>
      )}

      {sessionItems.length > 0 && (
        <Section id="mentions" label="Mentioned files">
          {sessionItems.map((item) => (
            <ContextFileItem
              key={item.path}
              testId={`session-panel-session-item-${item.path}`}
              path={item.path}
              badge={item.badge}
            />
          ))}
        </Section>
      )}

      <Section
        id="skills"
        label="Skills"
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
          <div data-testid="session-panel-skills-empty" className={PANEL_EMPTY}>
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
      </Section>

      {attachments.length > 0 && chatId != null && (
        <Section id="attachments" label="Attachments">
          <PanelAttachmentsGrid port={port} chatId={chatId} attachments={attachments} enabled />
        </Section>
      )}
    </>
  );
}

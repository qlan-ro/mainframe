/**
 * ContextSections — what the agent is working from: the memory files it
 * loaded, the files this session mentioned or edited, the skills it invoked,
 * and the session's attachments. Empty ones hide, except Skills.
 *
 * Every section reads the SAME source, the session context, so the panel
 * fetches it once (`SessionContextProvider`). Skills lists the skills THIS
 * session invoked (`skillFiles`), not the adapter's catalog — that belongs to
 * the Setup Advisor, which Manage reaches. It is the only route to that sheet,
 * so the Skills section renders even when empty.
 */
import { createContext, useContext, useState, type ReactNode } from 'react';
import { FileText } from 'lucide-react';
import { Hint } from '@/components/ui/hint';
import { useSessionContext } from '@/features/sessions/use-session-context';
import { useSetupAdvisor } from '@/features/setup-advisor/use-setup-advisor';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { ContextFileItem } from './ContextFileItem';
import { deriveContextFiles, type ContextFileRow } from './context-groups';
import { deriveSessionItems } from './derive-session-items';
import { formatTokens } from './context-tokens';
import { PanelAttachmentsGrid } from './PanelAttachmentsGrid';
import { PanelEmpty, PanelRow, PanelSection, ShowAllRow } from './PanelSection';

type SessionContextValue = ReturnType<typeof useSessionContext>;
const PanelContext = createContext<SessionContextValue>({ context: null, chatId: undefined });

export function SessionContextProvider({ children }: { children: ReactNode }) {
  return <PanelContext.Provider value={useSessionContext()}>{children}</PanelContext.Provider>;
}

function MemoryFileRow({ row }: { row: ContextFileRow }) {
  return (
    <Hint label={row.path}>
      <PanelRow
        data-testid={`session-panel-context-file-${row.path}`}
        onClick={() => emitSurfaceIntent({ type: 'open-file', path: row.path })}
        icon={<FileText />}
        label={row.label}
        value={
          <>
            {/* The tilde marks an estimate. */}
            {formatTokens(row.tokens)}
            <span className="w-12 text-right">{row.scope}</span>
          </>
        }
      />
    </Hint>
  );
}

export function MemorySection() {
  const files = deriveContextFiles(useContext(PanelContext).context);
  if (files.length === 0) return null;
  return (
    <PanelSection section="memory" data-testid="session-panel-section-memory">
      {files.map((row) => (
        <MemoryFileRow key={row.path} row={row} />
      ))}
    </PanelSection>
  );
}

const MENTIONS_SHOWN = 6;

export function MentionsSection() {
  const { context, chatId } = useContext(PanelContext);
  const [expandedIn, setExpandedIn] = useState<string>();
  const items = context ? deriveSessionItems(context) : [];
  if (items.length === 0) return null;
  const all = expandedIn !== undefined && expandedIn === chatId;
  return (
    <PanelSection section="mentions" data-testid="session-panel-section-mentions">
      {(all ? items : items.slice(0, MENTIONS_SHOWN)).map((item) => (
        <ContextFileItem key={item.path} path={item.path} reason={item.reason} />
      ))}
      {items.length > MENTIONS_SHOWN && (
        <ShowAllRow
          testId="session-panel-mentions-all"
          count={items.length}
          all={all}
          onToggle={() => setExpandedIn(all ? undefined : chatId)}
        />
      )}
    </PanelSection>
  );
}

export function SkillsSection() {
  const skillFiles = useContext(PanelContext).context?.skillFiles ?? [];
  const openSheet = useSetupAdvisor((s) => s.openSheet);
  return (
    <PanelSection
      section="skills"
      data-testid="session-panel-section-skills"
      action={
        <button
          type="button"
          data-testid="session-panel-skills-manage"
          onClick={() => openSheet('skills')}
          // The label line is 22px: the inset widens the target without moving the text.
          className="relative before:absolute before:-inset-x-2 before:-inset-y-1.5 before:content-[''] hover:text-foreground"
        >
          Manage
        </button>
      }
    >
      {skillFiles.length === 0 ? (
        <PanelEmpty data-testid="session-panel-skills-empty">No skills used</PanelEmpty>
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
    </PanelSection>
  );
}

export function AttachmentsSection({ port }: { port: number }) {
  const { context, chatId } = useContext(PanelContext);
  const attachments = context?.attachments ?? [];
  if (attachments.length === 0 || chatId == null) return null;
  return (
    <PanelSection section="attachments" data-testid="session-panel-section-attachments">
      <PanelAttachmentsGrid key={chatId} port={port} chatId={chatId} attachments={attachments} />
    </PanelSection>
  );
}

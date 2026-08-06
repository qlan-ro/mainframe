/**
 * ContextSection — what the agent is working from: the memory files it loaded,
 * the files this session touched, the skills available to it, and the session's
 * attachments.
 *
 * Four sub-groups, deliberately overlapping in one place: a skill FILE used this
 * session appears under Session with a `skill` badge, while Skills below lists
 * the adapter's AVAILABLE skills — two lists from two sources, as they are today.
 *
 * Manage is carried over from the retired bottom panel's skills tab: it is the
 * only route to the Setup Advisor's skills sheet.
 */
import { Layers } from 'lucide-react';
import { Badge } from '@v2/components/ui/badge';
import { Button } from '@v2/components/ui/button';
import { Hint } from '@v2/components/ui/hint';
import type { Skill } from '@qlan-ro/mainframe-types';
import { ContextFileItem } from '@/features/context-panel/ContextFileItem';
import { deriveSessionItems } from '@/features/context-panel/derive-session-items';
import { useSessionContext } from '@/features/context-panel/use-session-context';
import { useSidebarSkills } from '@/features/context-panel/use-sidebar-skills';
import { useSetupAdvisor } from '@/features/setup-advisor/use-setup-advisor';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { deriveContextFiles, type ContextFileRow } from './context-groups';
import { formatTokens } from './context-tokens';
import { PanelAttachmentsGrid } from './PanelAttachmentsGrid';
import { PanelSection } from './PanelSection';
import { PanelSubGroup } from './PanelSubGroup';

const SUB_ROW =
  'flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-background';
const SUB_NOTE = 'px-1 py-1 text-xs text-muted-foreground';

function MemoryFileRow({ row }: { row: ContextFileRow }) {
  return (
    <Hint label={row.path}>
      <button
        type="button"
        data-testid={`session-panel-context-file-${row.path}`}
        onClick={() => emitSurfaceIntent({ type: 'open-file', path: row.path })}
        className={SUB_ROW}
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

function SkillRow({ skill }: { skill: Skill }) {
  return (
    <Hint label={skill.description || skill.filePath}>
      <button
        type="button"
        data-testid={`session-panel-skill-${skill.id}`}
        onClick={() => emitSurfaceIntent({ type: 'open-file', path: skill.filePath })}
        className={SUB_ROW}
      >
        <span className="min-w-0 flex-1 truncate text-sm">/{skill.displayName || skill.name}</span>
        {/* `scope` comes off the wire as project / global / plugin and reads verbatim. */}
        <Badge variant="outline">{skill.scope}</Badge>
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
  const { skills, loading } = useSidebarSkills();
  const openSheet = useSetupAdvisor((s) => s.openSheet);

  const memoryFiles = deriveContextFiles(context);
  const sessionItems = context ? deriveSessionItems(context) : [];
  const attachments = context?.attachments ?? [];
  const count = memoryFiles.length + sessionItems.length + skills.length + attachments.length;

  return (
    <PanelSection
      id="context"
      label="Context"
      icon={Layers}
      count={count}
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
              displayName={item.displayName}
              badge={item.badge}
            />
          ))}
        </PanelSubGroup>
      )}

      <PanelSubGroup
        label="Skills"
        count={skills.length}
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
        {skills.length === 0 ? (
          <div data-testid="session-panel-skills-empty" className={SUB_NOTE}>
            {loading ? 'Loading…' : 'No skills'}
          </div>
        ) : (
          skills.map((skill) => <SkillRow key={skill.id} skill={skill} />)
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

/**
 * Read-only inspect view for one skill: its metadata and its raw SKILL.md.
 *
 * The body is rendered verbatim in a `<pre>` rather than through a markdown
 * renderer — what the CLI reads is exactly what the user should see, and it
 * keeps a heavy dependency out of the dialog.
 */
import { ArrowLeft, Trash2 } from 'lucide-react';
import type { Skill } from '@qlan-ro/mainframe-types';
import { parseSkillContent } from './skill-content';
import { ScopeChip } from './SkillRow';

interface SkillInspectProps {
  skill: Skill;
  onBack: () => void;
  onDelete?: (skill: Skill) => void;
}

export function SkillInspect({ skill, onBack, onDelete }: SkillInspectProps) {
  const { frontmatter, body } = parseSkillContent(skill.content);

  return (
    <div data-testid="skills-section-inspect" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-4 py-2.5">
        <button
          type="button"
          data-testid="skills-section-inspect-back"
          onClick={onBack}
          aria-label="Back to skills"
          className="flex-shrink-0 rounded-[6px] p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft size={14} />
        </button>
        <span className="min-w-0 flex-1 truncate text-heading font-bold text-foreground">
          {skill.displayName || skill.name}
        </span>
        <ScopeChip skill={skill} />
        {onDelete && (
          <button
            type="button"
            data-testid={`skills-section-delete-${skill.id}`}
            aria-label={`Delete ${skill.displayName || skill.name}`}
            onClick={() => onDelete(skill)}
            className="flex-shrink-0 rounded-[6px] p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {skill.description && <p className="text-body text-muted-foreground">{skill.description}</p>}
        <p className="mt-1 select-text truncate font-mono text-caption text-mf-text-3">{skill.filePath}</p>

        {frontmatter && (
          <pre className="mt-3 select-text whitespace-pre-wrap rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-caption text-muted-foreground">
            {frontmatter}
          </pre>
        )}
        <pre className="mt-3 select-text whitespace-pre-wrap font-mono text-caption text-foreground">{body}</pre>
      </div>
    </div>
  );
}

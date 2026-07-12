/**
 * DescribeFlow — textarea + "Draft it" + hint state (ts153 wf2-runtime.jsx
 * `WfDescribeFlow`), gated behind `DESCRIBE_ENABLED` (contract §9: no
 * drafting endpoint yet). "Draft it" always resolves to the same canned
 * fixture, never the typed description — the point under test is the
 * artifact shape (an editable block list, never a buried prompt), not NL
 * parsing, which is a Node-plan dependency. Self-sufficient like
 * `AutomationEditor`: reads/writes `use-automations-nav`/
 * `use-automations-store` directly.
 */
import { useState } from 'react';
import { ChevronLeft, Lightbulb, Sparkles, Wand2 } from 'lucide-react';
import { Hint } from '@/components/ui/hint';
import type { AutomationCreateInput } from '../contract';
import { useAutomationsNav } from '../data/use-automations-nav';
import { useAutomationsStore } from '../data/use-automations-store';
import { AUTOMATION_FIXTURES } from '../fixtures/fixtures';
import { DraftPreview } from './DraftPreview';

const CANNED_DRAFT: AutomationCreateInput = AUTOMATION_FIXTURES[0]!;

export function DescribeFlow() {
  const closeDescribe = useAutomationsNav((s) => s.closeDescribe);
  const openEditor = useAutomationsNav((s) => s.openEditor);
  const catalog = useAutomationsStore((s) => s.catalog);
  const [text, setText] = useState("Every evening ask me about the kid's health and log it to Notion");
  const [draft, setDraft] = useState<AutomationCreateInput | null>(null);

  return (
    <div data-testid="automations-describe" className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-3.5 py-3">
        <Hint label="Back">
          <button
            type="button"
            data-testid="automations-describe-back"
            onClick={closeDescribe}
            className="flex size-[30px] items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
          >
            <ChevronLeft size={15} aria-hidden />
          </button>
        </Hint>
        <Wand2 size={16} className="text-primary" aria-hidden />
        <span className="text-heading font-bold tracking-tight text-foreground">Describe your workflow</span>
      </div>

      <div className="flex shrink-0 gap-2.5 border-b border-border p-3.5">
        <textarea
          data-testid="automations-describe-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="min-h-[54px] flex-1 resize-none rounded-md border-[0.5px] border-input bg-card px-3 py-2 text-body text-foreground outline-none"
        />
        <button
          type="button"
          data-testid="automations-describe-draft"
          onClick={() => setDraft(CANNED_DRAFT)}
          className="inline-flex h-[38px] shrink-0 items-center gap-1.5 self-end rounded-md bg-primary px-3.5 text-label font-semibold text-primary-foreground hover:opacity-90"
        >
          <Wand2 size={13} aria-hidden />
          Draft it
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {draft ? (
          <div className="flex flex-col gap-3.5">
            <div className="flex items-center gap-1.5 text-caption text-muted-foreground">
              <Sparkles size={12} className="text-primary" aria-hidden />
              Here's a draft. Open it to tweak anything.
            </div>
            <DraftPreview draft={draft} catalog={catalog} />
            <div className="flex gap-2">
              <button
                type="button"
                data-testid="automations-describe-open-editor"
                onClick={() => openEditor({ mode: 'new', draft })}
                className="h-[34px] rounded-md bg-primary px-3.5 text-label font-semibold text-primary-foreground hover:opacity-90"
              >
                Open in editor
              </button>
              <button
                type="button"
                data-testid="automations-describe-retry"
                onClick={() => setDraft(null)}
                className="h-[34px] rounded-md border-[0.5px] border-border px-3.5 text-label font-medium text-muted-foreground hover:bg-accent"
              >
                Try a different description
              </button>
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <Lightbulb size={20} aria-hidden />
            <p className="max-w-[320px] text-caption leading-relaxed">
              The artifact is always an editable block list — never a buried prompt. Try “When a PR opens, review it and
              post a summary.”
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

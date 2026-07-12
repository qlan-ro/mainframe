/**
 * AttachmentsField — image/file chips handed to the agent alongside its
 * prompt (ts153 wf2-stepconfig.jsx `WfAttachments`, wired into
 * `AgentConfig`'s More options — wf2-stepconfig.jsx:45-63, wired :185-187).
 *
 * The ratified `AskAgentStep` originally shipped without this field (see the
 * removed doc note in `AgentConfig.tsx`'s history); the 2026-07-12
 * design-conformance pass reverses that call and adds `attachments?:
 * string[]` to the contract (`packages/types/src/automation.ts`) plus the
 * matching zod field on the daemon's write-path validator
 * (`packages/core/src/automations/definition/schema.ts`) — flagged
 * prominently, since it widens the wire shape outside this package.
 *
 * Names only, no upload/storage path exists yet — matching ts153's own mock
 * (`add('image')` always synthesizes a placeholder name; there is no real
 * file picker in the prototype either). `kind` (image vs file icon) isn't
 * wire-carried, so it's inferred from the filename extension, purely for
 * display.
 */
import { FileText, Image as ImageIcon, Paperclip, X } from 'lucide-react';
import { useState } from 'react';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);

function isImageName(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase();
  return !!ext && IMAGE_EXTENSIONS.has(ext);
}

export interface AttachmentsFieldProps {
  value: string[];
  onChange: (next: string[]) => void;
  testId: string;
}

export function AttachmentsField({ value, onChange, testId }: AttachmentsFieldProps) {
  const [seq, setSeq] = useState(0);

  function add() {
    const n = seq + 1;
    setSeq(n);
    onChange([...value, `screenshot-${n}.png`]);
  }

  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <div data-testid={testId} className="flex flex-wrap items-center gap-[6px]">
      {value.map((name, i) => {
        const Icon = isImageName(name) ? ImageIcon : FileText;
        return (
          <span
            key={i}
            className="inline-flex h-[24px] items-center gap-1 rounded-full bg-muted pl-[9px] pr-1 text-caption font-medium text-foreground"
          >
            <Icon size={11} className="text-muted-foreground" aria-hidden />
            {name}
            <button
              type="button"
              data-testid={`${testId}-remove-${i}`}
              onClick={() => remove(i)}
              aria-label={`Remove ${name}`}
              className="flex size-[14px] shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10"
            >
              <X size={7} aria-hidden />
            </button>
          </span>
        );
      })}
      <button
        type="button"
        data-testid={`${testId}-add`}
        onClick={add}
        className="inline-flex h-[24px] items-center gap-1 rounded-full border border-dashed border-mf-border-hover px-[10px] text-caption font-semibold text-primary hover:bg-accent"
      >
        <Paperclip size={11} aria-hidden />
        Add image or file…
      </button>
    </div>
  );
}

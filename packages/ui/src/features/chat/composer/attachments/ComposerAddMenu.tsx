'use client';

/** The composer's `+` (C4): attach files, or mention a file or agent. */
import { useRef, useState, type RefObject } from 'react';
import { AtSignIcon, PlusIcon } from 'lucide-react';
import { PaperclipIcon } from '@/components/ui/glyphs';
import { ComposerPrimitive, useAui } from '@assistant-ui/react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ComposerHint } from '../composer-card-context';
import { toolbarButton } from '../config-toolbar/toolbar-button';
import { readLiveComposerState } from '../read-live-composer-state';
import { mentionDraft, writeComposerDraft } from '../triggers/open-mention-trigger';

/**
 * Opens the same mention popover typing "@" does. The "@" is written into the
 * textarea through its real change path, not through `composer.setText`: a
 * programmatic write fires no DOM event, so the trigger engine's tracked
 * cursor never moves and detection finds nothing.
 */
function useOpenMention(textareaRef: RefObject<HTMLTextAreaElement | null>): () => void {
  const aui = useAui();
  return () => {
    const next = mentionDraft(readLiveComposerState(aui.composer).text);
    const el = textareaRef.current;
    if (el) writeComposerDraft(el, next);
    else aui.composer.setText(next);
  };
}

export function ComposerAddMenu({ textareaRef }: { textareaRef: RefObject<HTMLTextAreaElement | null> }) {
  const [open, setOpen] = useState(false);
  const openMention = useOpenMention(textareaRef);
  // The menu returns focus to its trigger as it closes; a pick that needs the
  // field, or the file dialog, runs after that.
  const afterClose = useRef<(() => void) | null>(null);
  const addFiles = useRef<HTMLButtonElement>(null);

  return (
    <>
      {/* aui's own add-attachment owns the file dialog; the menu item clicks it. */}
      <ComposerPrimitive.AddAttachment asChild>
        <button ref={addFiles} type="button" tabIndex={-1} aria-hidden className="hidden" />
      </ComposerPrimitive.AddAttachment>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <ComposerHint label="Attach or mention">
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-testid="composer-add-menu"
              aria-label="Attach or mention"
              className={toolbarButton(open, 'w-7 shrink-0 justify-center rounded-full p-0')}
            >
              <PlusIcon className="size-4" />
            </button>
          </DropdownMenuTrigger>
        </ComposerHint>
        <DropdownMenuContent
          align="start"
          side="top"
          sideOffset={6}
          className="w-65"
          onCloseAutoFocus={(e) => {
            const run = afterClose.current;
            if (!run) return;
            afterClose.current = null;
            e.preventDefault();
            run();
          }}
        >
          <DropdownMenuItem
            data-testid="composer-add-attachment"
            onSelect={() => {
              afterClose.current = () => addFiles.current?.click();
            }}
          >
            <PaperclipIcon />
            Attach files…
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid="composer-add-mention"
            onSelect={() => {
              afterClose.current = openMention;
            }}
          >
            <AtSignIcon />
            Mention a file or agent
            <DropdownMenuShortcut>@</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

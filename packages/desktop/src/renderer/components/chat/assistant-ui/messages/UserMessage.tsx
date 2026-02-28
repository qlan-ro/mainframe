import React from 'react';
import { Zap, Wrench, ClipboardList } from 'lucide-react';
import Markdown from 'react-markdown';
import { MessagePrimitive, useMessage } from '@assistant-ui/react';
import { getExternalStoreMessages } from '@assistant-ui/react';
import remarkGfm from 'remark-gfm';
import { markdownComponents } from '../parts/markdown-text';
import { useMainframeRuntime } from '../MainframeRuntimeProvider';
import { useSkillsStore } from '../../../../store/skills';
import type { DisplayMessage, DisplayContent } from '@mainframe/types';
import { PLAN_PREFIX, highlightMentions, resolveSkillName, parseRawCommand } from '../message-parsing';
import { ImageThumbs, FileAttachmentThumbs } from './ImageThumbs';

const REMARK_PLUGINS = [remarkGfm];

function MentionParagraph({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p {...props}>{highlightMentions(children)}</p>;
}

const userComponents = { ...markdownComponents, p: MentionParagraph };

export function UserMessage() {
  const message = useMessage();
  const { openLightbox } = useMainframeRuntime();
  const skills = useSkillsStore((s) => s.skills);
  const commands = useSkillsStore((s) => s.commands);

  const [original] = getExternalStoreMessages<DisplayMessage>(message);

  // Images from DisplayContent
  const imageBlocks = (original?.content?.filter((c): c is DisplayContent & { type: 'image' } => c.type === 'image') ??
    []) as { type: 'image'; mediaType: string; data: string }[];

  // File attachments from raw attachment metadata
  const rawAttachments = Array.isArray(original?.metadata?.attachments)
    ? (original!.metadata!.attachments as Array<{ name?: string; kind?: string }>)
        .filter((a) => a.kind === 'file' && !!a.name)
        .map((a) => ({ name: a.name! }))
    : [];

  // File attachments extracted by pipeline from <attached_file_path> tags
  const pipelineFiles = (original?.metadata?.attachedFiles as { name: string }[] | undefined) ?? [];

  // Command info from pipeline metadata (richer object stored by convertUserContent)
  const pipelineCommand = original?.metadata?.command as
    | { name: string; userText: string; isCommand: boolean }
    | undefined;

  const firstText = message.content.find((p): p is { type: 'text'; text: string } => p.type === 'text');
  const rawUserText = firstText?.text ?? '';

  // Use pipeline metadata when available, fall back to runtime parsing
  let parsed: { commandName: string; userText: string; isCommand: boolean } | null = null;
  if (pipelineCommand) {
    parsed = {
      commandName: resolveSkillName(pipelineCommand.name, skills),
      userText: pipelineCommand.userText,
      isCommand: pipelineCommand.isCommand,
    };
  } else if (rawUserText) {
    parsed = parseRawCommand(rawUserText, skills, commands);
  }

  // cleanText from pipeline metadata, or raw text as fallback
  const cleanText = (original?.metadata?.cleanText as string | undefined) ?? rawUserText;

  const mergedFileAttachments = [...rawAttachments, ...pipelineFiles].filter(
    (file, i, arr) => arr.findIndex((f) => f.name === file.name) === i,
  );

  if (cleanText.startsWith(PLAN_PREFIX)) {
    const planBody = cleanText.slice(PLAN_PREFIX.length);
    return (
      <MessagePrimitive.Root className="pt-2">
        <div className="border border-mf-accent/30 rounded-mf-card overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 bg-mf-accent/10">
            <ClipboardList size={16} className="text-mf-accent" />
            <span className="text-mf-body font-semibold text-mf-accent">Plan to implement</span>
          </div>
          <div className="px-4 py-3">
            <div className="aui-md text-mf-chat text-mf-text-primary">
              <Markdown remarkPlugins={REMARK_PLUGINS} components={markdownComponents}>
                {planBody}
              </Markdown>
            </div>
          </div>
        </div>
      </MessagePrimitive.Root>
    );
  }

  if (parsed) {
    const Icon = parsed.isCommand ? Wrench : Zap;
    return (
      <MessagePrimitive.Root className="flex flex-col items-end gap-2 pt-2">
        <div
          data-testid={parsed.isCommand ? 'user-command-bubble' : 'user-skill-bubble'}
          className="max-w-[75%] bg-mf-hover rounded-[12px_12px_4px_12px] px-4 py-2.5"
        >
          <div className="aui-md text-mf-chat text-mf-text-primary">
            <Icon size={14} className="text-mf-accent inline-block align-[-2px] mr-0.5" />
            <span className="font-mono text-mf-chat text-mf-accent mr-1.5">/{parsed.commandName}</span>
            {parsed.userText}
          </div>
        </div>
        <FileAttachmentThumbs attachments={mergedFileAttachments} />
        <ImageThumbs imageBlocks={imageBlocks} openLightbox={openLightbox} />
      </MessagePrimitive.Root>
    );
  }

  const hasTextContent = !!cleanText;

  return (
    <MessagePrimitive.Root className="flex flex-col items-end gap-2 pt-2">
      {hasTextContent && (
        <div className="max-w-[75%] bg-mf-hover rounded-[12px_12px_4px_12px] px-4 py-2.5">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="aui-md text-mf-chat text-mf-text-primary">
                <Markdown remarkPlugins={REMARK_PLUGINS} components={userComponents}>
                  {cleanText}
                </Markdown>
              </div>
            </div>
            {!!original?.metadata?.queued && (
              <span className="text-mf-small text-mf-text-secondary opacity-60 shrink-0 mt-0.5">Queued</span>
            )}
          </div>
        </div>
      )}
      <FileAttachmentThumbs attachments={mergedFileAttachments} />
      <ImageThumbs imageBlocks={imageBlocks} openLightbox={openLightbox} />
    </MessagePrimitive.Root>
  );
}

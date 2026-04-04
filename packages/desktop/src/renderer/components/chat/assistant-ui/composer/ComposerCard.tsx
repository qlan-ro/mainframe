import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowUp, Square, Paperclip, Shield, X, AlertTriangle, CopySlash, FolderGit, GitBranch } from 'lucide-react';
import { createLogger } from '../../../../lib/logger';

const log = createLogger('renderer:composer');
import { ComposerPrimitive, useThread, useComposerRuntime, type ComposerRuntime } from '@assistant-ui/react';
import { useMainframeRuntime } from '../MainframeRuntimeProvider';
import { useChatsStore } from '../../../../store/chats';
import { useSkillsStore } from '../../../../store/skills';
import { useAdaptersStore } from '../../../../store/adapters';
import { getAdapterOptions, getModelOptions } from '../../../../lib/adapters';
import { daemonClient } from '../../../../lib/client';
import { getGitBranch } from '../../../../lib/api';
import { focusComposerInput } from '../../../../lib/focus';
import { ContextPickerMenu } from '../../ContextPickerMenu';
import { ComposerDropdown } from './ComposerDropdown';
import { ComposerHighlight } from './ComposerHighlight';
import { ImageAttachmentPreview } from './ImageAttachmentPreview';
import { WorktreePopover } from './WorktreePopover';
import { QueuedMessageBanner } from './QueuedMessageBanner';
import { useSandboxStore, type Capture } from '../../../../store/sandbox.js';
import { getDraft, saveDraft, deleteDraft } from './composer-drafts.js';

const PERMISSION_MODES = [
  { id: 'default', label: 'Interactive' },
  { id: 'plan', label: 'Plan' },
  { id: 'acceptEdits', label: 'Auto-Edits' },
  { id: 'yolo', label: 'Unattended' },
];

// Two overlapping circles: back circle = /, front circle = @
function ContextPickerIcon() {
  return <CopySlash size={14} />;
}

function useComposerEmpty(composerRuntime: ComposerRuntime) {
  return useSyncExternalStore(
    (cb) => {
      try {
        return composerRuntime.subscribe(cb);
      } catch {
        return () => {};
      }
    },
    () => {
      try {
        return composerRuntime.getState().isEmpty;
      } catch {
        return true;
      }
    },
  );
}

function StopButton() {
  const thread = useThread();
  if (!thread.isRunning) return null;
  return (
    <ComposerPrimitive.Cancel
      className="w-7 h-7 flex items-center justify-center rounded-mf-input text-mf-text-secondary hover:bg-mf-hover hover:text-mf-destructive transition-colors"
      title="Stop response"
      aria-label="Stop response"
    >
      <Square size={12} />
    </ComposerPrimitive.Cancel>
  );
}

function SendButton({
  composerRuntime,
  hasCaptures,
  disabled: externalDisabled,
  chatId,
}: {
  composerRuntime: ComposerRuntime;
  hasCaptures: boolean;
  disabled?: boolean;
  chatId: string;
}) {
  const composerEmpty = useComposerEmpty(composerRuntime);
  const disabled = externalDisabled || (composerEmpty && !hasCaptures);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        try {
          composerRuntime.send();
          deleteDraft(chatId);
        } catch (err) {
          log.warn('failed to send from composer', { err: String(err) });
        }
      }}
      className="w-7 h-7 flex items-center justify-center rounded-mf-input text-mf-text-secondary hover:bg-mf-hover hover:text-mf-text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      title="Send message"
      aria-label="Send message"
    >
      <ArrowUp size={16} />
    </button>
  );
}

export function ComposerCard() {
  const { chatId, composerError, dismissComposerError, openLightbox } = useMainframeRuntime();
  const chat = useChatsStore((s) => s.chats.find((c) => c.id === chatId));
  const adapters = useAdaptersStore((s) => s.adapters);
  const messages = useChatsStore((s) => s.messages.get(chatId));
  const hasMessages = (messages?.length ?? 0) > 0;
  const composerRuntime = useComposerRuntime();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [worktreePopoverOpen, setWorktreePopoverOpen] = useState(false);
  const [isGitProject, setIsGitProject] = useState(false);
  const captures = useSandboxStore((s) => s.captures);
  const removeCapture = useSandboxStore((s) => s.removeCapture);

  const composerRuntimeRef = useRef(composerRuntime);
  composerRuntimeRef.current = composerRuntime;
  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;

  useEffect(() => {
    const draft = getDraft(chatId);
    if (draft) {
      deleteDraft(chatId);
      const restore = () => {
        try {
          composerRuntime.setText(draft.text);
          // Only add attachments if the runtime doesn't already have them
          // (React StrictMode re-runs effects without destroying the runtime)
          const existing = composerRuntime.getState()?.attachments?.length ?? 0;
          if (existing === 0) {
            for (const att of draft.attachments) {
              void composerRuntime.addAttachment(att as Parameters<typeof composerRuntime.addAttachment>[0]);
            }
          }
        } catch {
          /* composer not ready */
        }
        if (draft.captures.length > 0) {
          const store = useSandboxStore.getState();
          if (store.captures.length === 0) {
            for (const cap of draft.captures) store.addCapture(cap);
          }
        }
      };
      try {
        restore();
      } catch {
        requestAnimationFrame(restore);
      }
    }
    requestAnimationFrame(() => focusComposerInput());

    return () => {
      try {
        const state = composerRuntimeRef.current.getState();
        const text = state?.text ?? '';
        const attachments = (state?.attachments ?? []).map(
          (a: { type: string; name: string; contentType?: string; content?: unknown[] }) => ({
            type: a.type,
            name: a.name,
            contentType: a.contentType,
            content: a.content ?? [],
          }),
        );
        const caps: Omit<Capture, 'id'>[] = useSandboxStore.getState().captures.map(({ id: _, ...rest }) => rest);
        saveDraft(chatIdRef.current, { text, attachments, captures: caps });
        useSandboxStore.getState().clearCaptures();
      } catch {
        /* composerRuntime already disposed */
      }
    };
  }, [chatId]);

  const pendingInvocation = useSkillsStore((s) => s.pendingInvocation);
  useEffect(() => {
    if (pendingInvocation) {
      try {
        composerRuntime.setText(pendingInvocation);
        focusComposerInput();
      } catch (err) {
        log.warn('failed to set pending invocation', { err: String(err) });
      }
      useSkillsStore.getState().setPendingInvocation(null);
    }
  }, [pendingInvocation, composerRuntime]);

  useEffect(() => {
    const projectId = chat?.projectId;
    if (!projectId) {
      setIsGitProject(false);
      return;
    }
    getGitBranch(projectId)
      .then((res) => setIsGitProject(!!res.branch))
      .catch(() => setIsGitProject(false));
  }, [chat?.projectId]);

  const currentAdapter = chat?.adapterId ?? 'claude';
  const adapterOptions = getAdapterOptions(adapters);
  const modelOptions = getModelOptions(currentAdapter, adapters);
  const currentModel = chat?.model ?? modelOptions[0]?.id ?? '';

  const handleAdapterChange = useCallback(
    (adapterId: string) => {
      if (!chatId) return;
      const defaultModel = getModelOptions(adapterId, adapters)[0]?.id;
      daemonClient.updateChatConfig(chatId, adapterId, defaultModel);
    },
    [chatId, adapters],
  );

  const handleModelChange = useCallback(
    (model: string) => {
      if (!chatId) return;
      daemonClient.updateChatConfig(chatId, undefined, model);
    },
    [chatId],
  );

  const currentMode = chat?.permissionMode ?? 'default';

  const handleModeChange = useCallback(
    (mode: string) => {
      if (!chatId) return;
      daemonClient.updateChatConfig(chatId, undefined, undefined, mode as 'default' | 'acceptEdits' | 'plan' | 'yolo');
    },
    [chatId],
  );

  return (
    <ComposerPrimitive.Root
      data-tutorial="step-3"
      className="relative border border-mf-border rounded-mf-card bg-transparent"
    >
      <ContextPickerMenu forceOpen={pickerOpen} onClose={() => setPickerOpen(false)} />
      <div className="flex items-center gap-1 px-2 pt-2">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setPickerOpen((p) => !p);
            focusComposerInput();
          }}
          className="p-1.5 rounded-mf-input text-mf-text-secondary hover:bg-mf-hover hover:text-mf-text-primary transition-colors"
          title="Open context picker (agents, files, skills)"
          aria-label="Open context picker"
        >
          <ContextPickerIcon />
        </button>
        <ComposerPrimitive.AddAttachment
          className="p-1.5 rounded-mf-input text-mf-text-secondary hover:bg-mf-hover hover:text-mf-text-primary transition-colors"
          title="Add attachment"
          aria-label="Add attachment"
        >
          <Paperclip size={14} />
        </ComposerPrimitive.AddAttachment>
      </div>

      <div data-testid="composer-attachments" className="flex gap-2 px-3 pt-1 flex-wrap">
        <ComposerPrimitive.Attachments
          components={{
            Image: ImageAttachmentPreview,
            Attachment: ImageAttachmentPreview,
          }}
        />
        {captures.map((c, i) => (
          <div key={c.id} className="relative group w-14 h-14">
            <button
              type="button"
              data-testid="capture-thumb"
              className="w-full h-full rounded overflow-hidden border border-mf-border"
              onClick={() => {
                const images = captures.map((cap) => {
                  const match = cap.imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
                  return { mediaType: match?.[1] ?? 'image/png', data: match?.[2] ?? '' };
                });
                openLightbox(images, i);
              }}
            >
              <img
                src={c.imageDataUrl}
                alt={c.type === 'screenshot' ? 'screenshot' : (c.selector ?? 'element')}
                className="w-full h-full object-cover"
              />
            </button>
            <button
              type="button"
              onClick={() => removeCapture(c.id)}
              className="absolute -top-1 -right-1 w-4 h-4 bg-mf-text-primary rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label="Remove capture"
            >
              <X size={10} className="text-mf-panel-bg" />
            </button>
          </div>
        ))}
      </div>
      {composerError && (
        <div className="mx-3 mt-2 rounded-md bg-mf-chat-error/15 px-3 py-2 text-mf-small text-mf-chat-error-subtle flex items-center justify-between gap-2 shadow-chat-error-inset">
          <span>{composerError}</span>
          <button
            type="button"
            onClick={dismissComposerError}
            className="shrink-0 text-mf-chat-error-subtle/80 hover:text-mf-text-primary transition-colors"
            aria-label="Dismiss attachment error"
          >
            <X size={12} />
          </button>
        </div>
      )}
      {chat?.worktreeMissing && (
        <div className="mx-3 mt-2 rounded-md bg-mf-destructive/15 px-3 py-2 text-mf-small text-mf-destructive flex items-center gap-2">
          <AlertTriangle size={14} className="shrink-0" />
          <span>
            The worktree for this session was deleted. Archive this session or recreate the worktree at{' '}
            <code className="font-mono text-mf-status">{chat.worktreePath}</code>.
          </span>
        </div>
      )}

      <QueuedMessageBanner chatId={chatId} />
      <div className="relative">
        <ComposerHighlight />
        <ComposerPrimitive.Input
          data-mf-composer-input
          rows={2}
          autoFocus
          spellCheck={false}
          disabled={chat?.worktreeMissing}
          placeholder="Type @ to search files, / for skills… (Enter to send)"
          className="w-full bg-transparent border-none px-3 py-2 font-sans text-mf-chat text-transparent caret-mf-text-primary selection:text-mf-text-primary resize-none placeholder:text-mf-text-secondary focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && chat?.isRunning) {
              e.preventDefault();
              try {
                composerRuntime.send();
                deleteDraft(chatId);
              } catch (err) {
                log.warn('failed to send from composer', { err: String(err) });
              }
            }
          }}
        />
      </div>

      <div className="flex items-center justify-between px-2 pb-2">
        <div className="flex items-center gap-1">
          <ComposerDropdown
            data-tutorial="step-4"
            items={adapterOptions}
            value={currentAdapter}
            onChange={handleAdapterChange}
            disabled={hasMessages}
          />
          <ComposerDropdown items={modelOptions} value={currentModel} onChange={handleModelChange} />
          <ComposerDropdown
            items={PERMISSION_MODES}
            value={currentMode}
            onChange={handleModeChange}
            icon={<Shield size={14} />}
            className={
              currentMode === 'yolo' ? 'text-mf-destructive' : currentMode === 'plan' ? 'text-mf-accent' : undefined
            }
          />
          {isGitProject && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setWorktreePopoverOpen((o) => !o)}
                className={`flex items-center gap-1 px-2 py-1 rounded-mf-input text-mf-small transition-colors ${
                  chat?.worktreePath
                    ? 'text-mf-accent bg-mf-hover'
                    : 'text-mf-text-secondary hover:bg-mf-hover hover:text-mf-text-primary'
                }`}
                title={chat?.worktreePath ? `Branch: ${chat.branchName}` : 'Worktree isolation'}
                aria-label={chat?.worktreePath ? `Worktree on branch ${chat.branchName}` : 'Worktree isolation'}
              >
                {chat?.worktreePath ? <FolderGit size={14} /> : <GitBranch size={14} />}
              </button>
              {worktreePopoverOpen && chatId && (
                <WorktreePopover
                  chatId={chatId}
                  hasMessages={hasMessages}
                  onClose={() => setWorktreePopoverOpen(false)}
                />
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <StopButton />
          <SendButton
            composerRuntime={composerRuntime}
            hasCaptures={captures.length > 0}
            disabled={chat?.worktreeMissing}
            chatId={chatId}
          />
        </div>
      </div>
    </ComposerPrimitive.Root>
  );
}

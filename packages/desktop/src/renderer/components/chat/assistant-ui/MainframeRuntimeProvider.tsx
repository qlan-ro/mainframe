import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
  type PendingAttachment,
  type CompleteAttachment,
} from '@assistant-ui/react';
import type { AttachmentAdapter, ExternalStoreThreadListAdapter } from '@assistant-ui/react';
import { useChat } from '../../../hooks/useDaemon';
import { groupMessages, convertMessage } from './convert-message';
import { daemonClient } from '../../../lib/client';
import { archiveChat } from '../../../lib/api';
import { useChatsStore } from '../../../store/chats';
import { useProjectsStore } from '../../../store/projects';
import { useTabsStore } from '../../../store/tabs';
import type { PermissionRequest, PermissionUpdate } from '@mainframe/types';
import { AllToolUIs } from './parts/tool-ui-registry';

interface MainframeRuntimeProviderProps {
  chatId: string;
  children: React.ReactNode;
}

const MAX_SIZE = 5 * 1024 * 1024;
const DATA_URL_RE = /^data:([^;]+);base64,(.+)$/;
const IMAGE_COORDINATE_NOTE_RE =
  /\[Image:\s*original\s+\d+x\d+,\s*displayed at\s+\d+x\d+\.\s*Multiply coordinates by\s+[0-9.]+\s+to map to original image\.\]/g;
const FILE_SIZE_LIMIT_MB = 5;

interface MainframeRuntimeContextValue {
  chatId: string;
  pendingPermission: PermissionRequest | undefined;
  respondToPermission: (
    behavior: 'allow' | 'deny',
    alwaysAllow?: PermissionUpdate[],
    overrideInput?: Record<string, unknown>,
    message?: string,
    executionMode?: string,
    clearContext?: boolean,
  ) => void;
  composerError: string | null;
  dismissComposerError: () => void;
  lightbox: { images: { mediaType: string; data: string }[]; index: number } | null;
  openLightbox: (images: { mediaType: string; data: string }[], index: number) => void;
  closeLightbox: () => void;
  navigateLightbox: (index: number) => void;
}

const MainframeRuntimeContext = React.createContext<MainframeRuntimeContextValue | null>(null);

export function useMainframeRuntime() {
  const ctx = React.useContext(MainframeRuntimeContext);
  if (!ctx) throw new Error('useMainframeRuntime must be used within MainframeRuntimeProvider');
  return ctx;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatComposerError(error: unknown): string {
  const fallback = `Attachment upload failed. Files must be ${FILE_SIZE_LIMIT_MB}MB or smaller.`;
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const message = raw.trim();
  if (!message) return fallback;

  if (/5\s*mb/i.test(message) || /exceeds\s+5\s*mb/i.test(message) || /file too large/i.test(message)) {
    return `Attachment rejected. Files must be ${FILE_SIZE_LIMIT_MB}MB or smaller.`;
  }
  return `Attachment upload failed: ${message}`;
}

export function MainframeRuntimeProvider({ chatId, children }: MainframeRuntimeProviderProps) {
  const { messages: rawMessages, pendingPermission, sendMessage, respondToPermission } = useChat(chatId);
  const groupedMessages = useMemo(() => groupMessages(rawMessages), [rawMessages]);

  const [composerError, setComposerError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ images: { mediaType: string; data: string }[]; index: number } | null>(
    null,
  );
  const openLightbox = useCallback(
    (images: { mediaType: string; data: string }[], index: number) => setLightbox({ images, index }),
    [],
  );
  const closeLightbox = useCallback(() => setLightbox(null), []);
  const navigateLightbox = useCallback(
    (index: number) => setLightbox((prev) => (prev ? { ...prev, index } : null)),
    [],
  );
  const dismissComposerError = useCallback(() => setComposerError(null), []);

  useEffect(() => {
    setComposerError(null);
  }, [chatId]);

  const attachmentAdapter = useMemo<AttachmentAdapter>(
    () => ({
      accept: '*/*',
      async add({ file }) {
        if (file.size > MAX_SIZE) {
          setComposerError(`"${file.name}" is too large. Max file size is ${FILE_SIZE_LIMIT_MB}MB.`);
          throw new Error(`File too large (max ${FILE_SIZE_LIMIT_MB}MB)`);
        }
        const dataUrl = await readFileAsDataUrl(file);
        const isImage = file.type.startsWith('image/');
        return {
          id: crypto.randomUUID(),
          type: isImage ? 'image' : 'document',
          name: file.name,
          contentType: file.type || 'application/octet-stream',
          file,
          content: isImage ? [{ type: 'image', image: dataUrl }] : [{ type: 'text', text: dataUrl }],
          status: { type: 'requires-action', reason: 'composer-send' },
        } satisfies PendingAttachment;
      },
      async remove() {},
      async send(attachment) {
        return {
          id: attachment.id,
          type: attachment.type as 'image' | 'document',
          name: attachment.name,
          contentType: attachment.contentType,
          content: attachment.content ?? [],
          status: { type: 'complete' },
        } satisfies CompleteAttachment;
      },
    }),
    [setComposerError],
  );

  const onNew = useCallback(
    async (message: AppendMessage) => {
      if (pendingPermission) return;

      const textPart = message.content.find((p) => p.type === 'text');
      const uploadAttachments: {
        name: string;
        mediaType: string;
        sizeBytes: number;
        kind: 'image' | 'file';
        data: string;
        originalPath?: string;
      }[] = [];

      // Extract attachments from message.attachments (framework puts attachments here, not in content)
      if ('attachments' in message && Array.isArray(message.attachments)) {
        for (const att of message.attachments) {
          if (!att.content) continue;
          let dataUrl: string | undefined;
          for (const part of att.content) {
            if (part.type === 'image' && 'image' in part) {
              dataUrl = (part as { type: 'image'; image: string }).image;
              break;
            }
            if (part.type === 'text' && typeof part.text === 'string' && part.text.startsWith('data:')) {
              dataUrl = part.text;
              break;
            }
          }
          if (!dataUrl) continue;
          const match = dataUrl.match(DATA_URL_RE);
          if (!match) continue;
          const mediaType = match[1] || att.contentType || 'application/octet-stream';
          const data = match[2] || '';
          const file = att.file as (File & { path?: string }) | undefined;
          uploadAttachments.push({
            name: att.name,
            mediaType,
            sizeBytes: file?.size ?? Math.floor((data.length * 3) / 4),
            kind: mediaType.startsWith('image/') ? 'image' : 'file',
            data,
            originalPath: file?.path,
          });
        }
      }

      // Extract pasted inline images from message.content.
      for (const part of message.content) {
        if (part.type !== 'image' || !('image' in part)) continue;
        const dataUrl = (part as { type: 'image'; image: string }).image;
        const match = dataUrl.match(DATA_URL_RE);
        if (!match) continue;
        uploadAttachments.push({
          name: 'pasted-image.png',
          mediaType: match[1] || 'image/png',
          sizeBytes: Math.floor((match[2]!.length * 3) / 4),
          kind: 'image',
          data: match[2]!,
        });
      }

      const userText = textPart?.type === 'text' ? textPart.text.replace(IMAGE_COORDINATE_NOTE_RE, '').trim() : '';

      if (!userText && uploadAttachments.length === 0) return;

      try {
        setComposerError(null);
        if (uploadAttachments.length > 0) {
          await sendMessage(userText, uploadAttachments);
        } else {
          await sendMessage(userText);
        }
      } catch (error) {
        setComposerError(formatComposerError(error));
      }
    },
    [sendMessage, pendingPermission, setComposerError],
  );

  const isRunning = useChatsStore((s) => s.chats.find((c) => c.id === chatId)?.isRunning ?? false);

  const onCancel = useCallback(async () => {
    if (!chatId) return;
    daemonClient.interruptChat(chatId);
  }, [chatId]);

  // Thread list adapter
  const chats = useChatsStore((s) => s.chats);
  const setActiveChat = useChatsStore((s) => s.setActiveChat);
  const removeChat = useChatsStore((s) => s.removeChat);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);

  const threadListAdapter = useMemo<ExternalStoreThreadListAdapter>(
    () => ({
      threadId: chatId,
      threads: chats.map((c) => ({
        status: 'regular' as const,
        id: c.id,
        title: c.title || 'New Chat',
      })),
      onSwitchToThread: (threadId: string) => {
        const chat = chats.find((c) => c.id === threadId);
        setActiveChat(threadId);
        useTabsStore.getState().openChatTab(threadId, chat?.title);
        daemonClient.resumeChat(threadId);
      },
      onSwitchToNewThread: () => {
        if (!activeProjectId) return;
        daemonClient.createChat(activeProjectId, 'claude');
      },
      onArchive: async (threadId: string) => {
        await archiveChat(threadId);
        removeChat(threadId);
        useTabsStore.getState().closeTab(`chat:${threadId}`);
      },
    }),
    [chatId, chats, setActiveChat, removeChat, activeProjectId],
  );

  const runtime = useExternalStoreRuntime({
    isRunning,
    messages: groupedMessages,
    convertMessage,
    onNew,
    onCancel,
    adapters: {
      attachments: attachmentAdapter,
      threadList: threadListAdapter,
    },
  });

  const contextValue = useMemo<MainframeRuntimeContextValue>(
    () => ({
      chatId,
      pendingPermission,
      respondToPermission,
      composerError,
      dismissComposerError,
      lightbox,
      openLightbox,
      closeLightbox,
      navigateLightbox,
    }),
    [
      chatId,
      pendingPermission,
      respondToPermission,
      composerError,
      dismissComposerError,
      lightbox,
      openLightbox,
      closeLightbox,
      navigateLightbox,
    ],
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {AllToolUIs.map((ToolUI, i) => (
        <ToolUI key={i} />
      ))}
      <MainframeRuntimeContext.Provider value={contextValue}>{children}</MainframeRuntimeContext.Provider>
    </AssistantRuntimeProvider>
  );
}

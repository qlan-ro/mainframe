export interface ContextFile {
  path: string;
  content: string;
  source: 'global' | 'project';
}

export type MentionSource = 'user' | 'auto' | 'attachment';
export type MentionKind = 'file' | 'agent';

export interface SessionMention {
  id: string;
  kind: MentionKind;
  source: MentionSource;
  name: string;
  path?: string;
  timestamp: string;
}

export interface SessionAttachment {
  id: string;
  name: string;
  mediaType: string;
  sizeBytes: number;
  kind: 'image' | 'file';
  originalPath?: string;
}

export interface SkillFileEntry {
  path: string;
  displayName: string;
}

export interface SessionContext {
  globalFiles: ContextFile[];
  projectFiles: ContextFile[];
  mentions: SessionMention[];
  attachments: SessionAttachment[];
  modifiedFiles: string[];
  skillFiles: SkillFileEntry[];
}

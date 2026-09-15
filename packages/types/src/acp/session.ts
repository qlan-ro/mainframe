/**
 * Session setup and lifecycle (`initialize`, `session/new|prompt|cancel|
 * resume`), todo #350. Mirrors `mainframe-types/src/acp/session.rs` — see
 * that file's module doc for which fields are kept opaque (`unknown`) and
 * why (auth, elicitation, MCP wiring, session config options, the resume
 * cursor scheme are orthogonal to this task's payload grammar).
 */
import { z } from 'zod';
import { ContentBlockSchema } from './content.js';

export type SessionId = string;
export type ProtocolVersion = number;

/** The ACP v2 protocol version this vendored subset targets (spec decision 2: frozen snapshot `d0370de50e16`). */
export const PINNED_PROTOCOL_VERSION: ProtocolVersion = 2;

export const ImplementationSchema = z
  .object({
    name: z.string(),
    title: z.string().optional(),
    version: z.string(),
  })
  .loose();
export type Implementation = z.infer<typeof ImplementationSchema>;

export const InitializeRequestSchema = z
  .object({
    protocolVersion: z.number().int().nonnegative(),
    info: ImplementationSchema,
    capabilities: z.unknown().optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();
export type InitializeRequest = z.infer<typeof InitializeRequestSchema>;

export const InitializeResponseSchema = z
  .object({
    protocolVersion: z.number().int().nonnegative(),
    info: ImplementationSchema,
    capabilities: z.unknown().optional(),
    authMethods: z.array(z.unknown()).optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();
export type InitializeResponse = z.infer<typeof InitializeResponseSchema>;

export const NewSessionRequestSchema = z
  .object({
    cwd: z.string(),
    additionalDirectories: z.array(z.string()).optional(),
    mcpServers: z.array(z.unknown()).optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();
export type NewSessionRequest = z.infer<typeof NewSessionRequestSchema>;

export const NewSessionResponseSchema = z
  .object({
    sessionId: z.string(),
    configOptions: z.array(z.unknown()).optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();
export type NewSessionResponse = z.infer<typeof NewSessionResponseSchema>;

export const PromptRequestSchema = z
  .object({
    sessionId: z.string(),
    prompt: z.array(ContentBlockSchema),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();
export type PromptRequest = z.infer<typeof PromptRequestSchema>;

/**
 * Acceptance of a prompt, distinct from turn completion (spec: "`session/
 * prompt` acceptance is separate from turn completion"). `_meta` carries the
 * Mainframe queued-state extension when the prompt was accepted mid-turn.
 */
export const PromptResponseSchema = z
  .object({
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();
export type PromptResponse = z.infer<typeof PromptResponseSchema>;

export const CancelSessionNotificationSchema = z
  .object({
    sessionId: z.string(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();
export type CancelSessionNotification = z.infer<typeof CancelSessionNotificationSchema>;

export const ResumeSessionRequestSchema = z
  .object({
    sessionId: z.string(),
    cwd: z.string(),
    additionalDirectories: z.array(z.string()).optional(),
    mcpServers: z.array(z.unknown()).optional(),
    /** Opaque replay cursor — the cursor scheme itself is group E's concern (plan task 15). */
    replayFrom: z.unknown().optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();
export type ResumeSessionRequest = z.infer<typeof ResumeSessionRequestSchema>;

export const ResumeSessionResponseSchema = z
  .object({
    configOptions: z.array(z.unknown()).optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();
export type ResumeSessionResponse = z.infer<typeof ResumeSessionResponseSchema>;

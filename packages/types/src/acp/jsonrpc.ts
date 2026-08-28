/**
 * JSON-RPC 2.0 envelope — ACP's transport framing (todo #350). Mirrors
 * `packages/core-rs/crates/mainframe-types/src/acp/jsonrpc.rs`. Method-
 * specific params/results are typed in the sibling modules and travel inside
 * `params`/`result` as `unknown` — the facade connection (out of this task's
 * scope) dispatches on `method` before typing the payload.
 */
import { z } from 'zod';

export const JsonRpcRequestIdSchema = z.union([z.number(), z.string()]);
export type JsonRpcRequestId = z.infer<typeof JsonRpcRequestIdSchema>;

export const JsonRpcRequestSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    id: JsonRpcRequestIdSchema.nullable(),
    method: z.string(),
    params: z.unknown().optional(),
  })
  .loose();
export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;

export const JsonRpcNotificationSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    method: z.string(),
    params: z.unknown().optional(),
  })
  .loose();
export type JsonRpcNotification = z.infer<typeof JsonRpcNotificationSchema>;

export const JsonRpcErrorObjectSchema = z
  .object({
    code: z.number().int(),
    message: z.string(),
    data: z.unknown().optional(),
  })
  .loose();
export type JsonRpcErrorObject = z.infer<typeof JsonRpcErrorObjectSchema>;

/** Predefined JSON-RPC/ACP error codes; any other integer is a valid ACP-specific code. */
export const ErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  REQUEST_CANCELLED: -32800,
  AUTHENTICATION_REQUIRED: -32000,
  RESOURCE_NOT_FOUND: -32002,
  /** Mainframe-specific: `initialize` requested an unsupported `protocolVersion` (acceptance criterion 1). */
  UNSUPPORTED_PROTOCOL_VERSION: -32001,
} as const;

const JsonRpcResponseResultSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    id: JsonRpcRequestIdSchema.nullable(),
    result: z.unknown(),
  })
  .loose();

const JsonRpcResponseErrorSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    id: JsonRpcRequestIdSchema.nullable(),
    error: JsonRpcErrorObjectSchema,
  })
  .loose();

/** The response body is exactly one of `result`/`error` — distinguished by which key is present. */
export const JsonRpcResponseSchema = z.union([JsonRpcResponseResultSchema, JsonRpcResponseErrorSchema]);
export type JsonRpcResponse = z.infer<typeof JsonRpcResponseSchema>;

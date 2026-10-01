/**
 * Gate (permission request/resolve/reply) tracking for `AcpSessionPlane` —
 * split out once that file crossed 300 lines absorbing the D4 staged-replay
 * store/window wiring. Owns the `requestId → gate-{id}` correlation map; the
 * plane keeps everything else (transcript, run state).
 */
import { z } from 'zod';
import { MAINFRAME_META_NAMESPACE } from '@qlan-ro/mainframe-types';
import type {
  ControlRequest,
  ControlResponse,
  JsonRpcRequestId,
  RequestPermissionRequest,
} from '@qlan-ro/mainframe-types';
import { buildAcpRichAnswer } from '../gates/build-acp-permission-response';
import { resolveGateControlRequest } from './synthesize-control-request';
import type { ChatStateEvent } from './chat-thread-state';
import type { AcpSessionClientPort } from './acp-session-attachment';

const GateMetaSchema = z.object({ controlRequest: z.record(z.string(), z.unknown()) }).loose();

export interface AcpGateTrackerHost {
  dispatch(event: ChatStateEvent): void;
  requireClient(): Pick<AcpSessionClientPort, 'respondPermission'>;
}

export class AcpGateTracker {
  /** ControlRequest.requestId → the JSON-RPC id its gate traveled under. */
  private readonly gateRpcIds = new Map<string, JsonRpcRequestId>();

  constructor(private readonly host: AcpGateTrackerHost) {}

  /**
   * `session/request_permission` → `ChatPermissionEntry`: the carried `ControlRequest`
   * (rich cards render it) plus the wire-level `options` (rendered verbatim, spec
   * decision 12). A missing/unparseable `_meta` — version-skewed daemon, or a
   * non-Mainframe ACP agent — synthesizes a stand-in `ControlRequest` rather than
   * dropping the gate: `options` alone is the presentation floor (spec decision 27).
   */
  handleGate(rpcId: JsonRpcRequestId, request: RequestPermissionRequest): void {
    const parsed = GateMetaSchema.safeParse(request._meta?.[MAINFRAME_META_NAMESPACE]);
    const carried = parsed.success ? (parsed.data.controlRequest as unknown as ControlRequest) : undefined;
    const { control, synthesized } = resolveGateControlRequest(rpcId, request, carried);
    if (synthesized) console.warn('[acp-session] gate has no usable controlRequest — rendering from options alone');
    this.gateRpcIds.set(control.requestId, rpcId);
    this.host.dispatch({
      type: 'permission.requested',
      requestId: control.requestId,
      request: control,
      options: request.options,
      synthesizedRequest: synthesized,
    });
  }

  /** The gate resolved elsewhere (`_mainframe.dev/gate_resolved`); rpc ids are `gate-{requestId}`. */
  handleGateResolved(rpcId: string): void {
    const requestId = rpcId.startsWith('gate-') ? rpcId.slice('gate-'.length) : rpcId;
    this.gateRpcIds.delete(requestId);
    this.host.dispatch({ type: 'permission.resolved', requestId });
  }

  /**
   * Answer a gate with the rich `_mainframe.dev` payload (spec decision 12).
   * `selectedOptionId` is the offered option the user actually clicked, so
   * the plain half of the answer is truthful end-to-end; only a gate that
   * answers without picking an option (Plan, AskUserQuestion) falls back to
   * a behavior-derived id. The daemon prefers the carried `ControlResponse`
   * either way, never inferring from the option.
   */
  replyToPermission(response: ControlResponse, selectedOptionId?: string): void {
    const rpcId = this.gateRpcIds.get(response.requestId) ?? `gate-${response.requestId}`;
    this.gateRpcIds.delete(response.requestId);
    const optionId = selectedOptionId ?? (response.behavior === 'deny' ? 'reject-once' : 'allow-once');
    this.host.requireClient().respondPermission(rpcId, buildAcpRichAnswer(optionId, response));
    this.host.dispatch({ type: 'permission.resolved', requestId: response.requestId });
  }
}

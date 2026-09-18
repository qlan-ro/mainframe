import { MAINFRAME_META_NAMESPACE } from '@qlan-ro/mainframe-types';
import type { ControlResponse, RequestPermissionResponse } from '@qlan-ro/mainframe-types';

/**
 * A rich `session/request_permission` answer: the plain option selection,
 * plus today's full `ControlResponse` semantics riding `_meta["_mainframe.dev"]`
 * (spec decision 12). The legacy `build-control-response.ts` builders map each
 * gate's UI outcome to the `ControlResponse`; this wraps that result for the
 * facade wire. The daemon validates `controlResponse.requestId`/`toolUseId`
 * against the request it claims to resolve before trusting it
 * (`mainframe-acp/src/gates.rs::rich_answer`).
 */
export function buildAcpRichAnswer(optionId: string, controlResponse: ControlResponse): RequestPermissionResponse {
  return {
    outcome: { outcome: 'selected', optionId },
    _meta: { [MAINFRAME_META_NAMESPACE]: { controlResponse } },
  };
}

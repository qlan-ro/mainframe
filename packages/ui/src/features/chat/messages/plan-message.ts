/**
 * Plan-message detection — the two ways an approved plan reaches the thread.
 *
 * 1. Approve **with "clear context"** → the daemon starts a fresh session and
 *    sends a *user* message prefixed `Implement the following plan:\n\n<plan>`
 *    (core `plan-mode-handler.ts` `onApproveAndClearContext`). This string is
 *    OURS, so the match is stable.
 * 2. Approve **without clear context** → the CLI's `ExitPlanMode` *tool result*
 *    announces approval ("User has approved your plan …") and echoes the plan
 *    under a "## Approved Plan" heading. This wording is CLI-generated and may
 *    drift across CLI versions — a miss simply falls back to the raw plan card.
 *
 * Both render as the same `PlanBubble` ("Implementing plan" / Approved).
 */

/** Matches the daemon's `Implement the following plan:\n\n` user-message prefix. */
const PLAN_USER_PREFIX_RE = /^Implement the following plan:\s*\n+/;

/** Matches the CLI's echoed "## Approved Plan …" heading line. */
const APPROVED_PLAN_HEADING_RE = /^[ \t]*#{1,6}[ \t]*Approved Plan[^\n]*\n/im;

/**
 * Clear-context path. Returns the plan body if `text` is a plan-implementation
 * user message, else `null`.
 */
export function parsePlanUserMessage(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = PLAN_USER_PREFIX_RE.exec(text);
  if (!match) return null;
  const body = text.slice(match[0].length).trim();
  return body.length > 0 ? body : null;
}

/**
 * No-clear-context path. Returns the approved plan body if `result` is an
 * `ExitPlanMode` approval result, else `null`. Prefers the text after the
 * "## Approved Plan" heading (dropping the approval boilerplate); falls back to
 * the whole result when approval is signalled but no heading is present.
 */
export function parseApprovedPlanResult(result: string | null | undefined): string | null {
  if (!result) return null;
  const headingMatch = APPROVED_PLAN_HEADING_RE.exec(result);
  const isApproved = /approved your plan/i.test(result) || headingMatch != null;
  if (!isApproved) return null;
  const body = (headingMatch ? result.slice(headingMatch.index + headingMatch[0].length) : result).trim();
  return body.length > 0 ? body : null;
}

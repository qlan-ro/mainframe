/**
 * SchedulePillCard — marker pill for schedule/cron/monitor tool calls.
 *
 * Registry keys: 'ScheduleWakeup', 'CronCreate', 'CronDelete', 'CronList', 'Monitor'.
 * Visual family: centered marker pill (MarkerWrap/MarkerPill).
 *
 * Behavior (from desktop SchedulePill.tsx + 10-chatcards.jsx SchedulePill):
 *   - Icon by kind: clock=wakeup, calendar=create/delete/list, activity=monitor.
 *   - Label by kind (see buildLabel below).
 *   - CronList and Monitor are expandable when done.
 *   - Tooltip on wakeup=prompt, create=cron+prompt.
 */
import React from 'react';
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { AlarmClockIcon, CalendarClockIcon, CalendarXIcon, CalendarDaysIcon, ActivityIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MarkerWrap, MarkerPill, MarkerBody, MarkerPre, useMarkerOpen, type MarkerState } from './marker-pill';
import { isErrorResult, extractResultContent } from '../shared/result';

// ── Types ─────────────────────────────────────────────────────────────────────

type ScheduleKind = 'ScheduleWakeup' | 'CronCreate' | 'CronDelete' | 'CronList' | 'Monitor';

const TOOL_ICONS: Record<ScheduleKind, React.ReactElement> = {
  ScheduleWakeup: <AlarmClockIcon size={12} />,
  CronCreate: <CalendarClockIcon size={12} />,
  CronDelete: <CalendarXIcon size={12} />,
  CronList: <CalendarDaysIcon size={12} />,
  Monitor: <ActivityIcon size={12} />,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDelay(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const r = seconds % 60;
  return r > 0 ? `${m}m ${r}s` : `${m}m`;
}

function parseResultObject(result: unknown): { text: string; parsed: unknown } {
  const text = extractResultContent(result);
  try {
    return { text, parsed: JSON.parse(text) };
  } catch {
    /* expected: non-JSON result text */
  }
  return { text, parsed: null };
}

// ── Label builders ────────────────────────────────────────────────────────────

function buildPendingLabel(kind: ScheduleKind, args: Record<string, unknown>): React.ReactNode {
  if (kind === 'Monitor') {
    const desc = String(args['description'] ?? args['command'] ?? '');
    return (
      <>
        Monitoring: <span className="text-primary">{desc}</span>
      </>
    );
  }
  const map: Record<ScheduleKind, string> = {
    ScheduleWakeup: 'Scheduling wakeup…',
    CronCreate: 'Creating schedule…',
    CronDelete: 'Removing schedule…',
    CronList: 'Listing schedules…',
    Monitor: 'Monitoring…',
  };
  return map[kind];
}

function buildDoneLabel(kind: ScheduleKind, args: Record<string, unknown>, parsed: unknown): React.ReactNode {
  if (kind === 'ScheduleWakeup') {
    const delay = formatDelay(Number(args['delaySeconds'] ?? 0));
    const reason = String(args['reason'] ?? '');
    return (
      <>
        Will resume in <span className="text-primary">{delay}</span>
        {reason ? ` · ${reason}` : ''}
      </>
    );
  }
  if (kind === 'CronCreate') {
    const obj = parsed as Record<string, unknown> | null;
    const human = String(obj?.['humanSchedule'] ?? args['cron'] ?? '');
    const recurring = Boolean(obj?.['recurring'] ?? args['recurring']);
    const durable = obj?.['durable'];
    return (
      <>
        Scheduled: <span className="text-primary">{human}</span>
        {' · '}
        <span className="text-mf-text-4">{recurring ? 'recurring' : 'one-shot'}</span>
        {durable === false && <span className="text-mf-text-4"> · session-only</span>}
      </>
    );
  }
  if (kind === 'CronDelete') {
    return (
      <>
        Removed schedule · <span className="font-mono text-primary">{String(args['id'] ?? '')}</span>
      </>
    );
  }
  if (kind === 'CronList') {
    const jobs = Array.isArray(parsed) ? parsed : [];
    return (
      <>
        Listed <span className="text-primary">{jobs.length}</span> scheduled job
        {jobs.length === 1 ? '' : 's'}
      </>
    );
  }
  // Monitor (done)
  const desc = String(args['description'] ?? args['command'] ?? '');
  return (
    <>
      Stopped monitoring: <span className="text-primary">{desc}</span>
    </>
  );
}

// ── Body builders ─────────────────────────────────────────────────────────────

function buildBody(kind: ScheduleKind, parsed: unknown, text: string): React.ReactNode | null {
  if (kind === 'CronList') {
    const jobs = Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];
    if (jobs.length === 0) return null;
    return (
      <div className="flex flex-col gap-1.5 font-mono text-caption text-mf-text-3 max-h-72 overflow-y-auto">
        {jobs.map((j) => (
          <div key={String(j['id'] ?? '')}>
            <div>
              {'• '}
              <span className="text-primary">{String(j['id'] ?? '')}</span>{' '}
              {String(j['humanSchedule'] ?? j['cron'] ?? '')}{' '}
              <span className="text-mf-text-4">
                ({j['recurring'] ? 'recurring' : 'one-shot'}
                {j['durable'] === false ? ', session-only' : ''})
              </span>
            </div>
            {Boolean(j['prompt']) && <div className="pl-3 text-mf-text-4">prompt: {String(j['prompt'])}</div>}
          </div>
        ))}
      </div>
    );
  }
  if (kind === 'Monitor' && text) {
    return <MarkerPre muted>{text}</MarkerPre>;
  }
  return null;
}

// ── Tooltip content ───────────────────────────────────────────────────────────

function buildTooltip(kind: ScheduleKind, args: Record<string, unknown>): string | null {
  if (kind === 'ScheduleWakeup') return String(args['prompt'] ?? '') || null;
  if (kind === 'CronCreate') {
    const parts = [String(args['cron'] ?? ''), String(args['prompt'] ?? '')].filter(Boolean);
    return parts.join('\n\n') || null;
  }
  return null;
}

// ── SchedulePillCard ──────────────────────────────────────────────────────────

function buildScheduleCard(kind: ScheduleKind): ToolCallMessagePartComponent {
  const Card: ToolCallMessagePartComponent = ({ args, result, isError }) => {
    const { open, toggle } = useMarkerOpen(false);
    const isPending = result === undefined;
    const errored = !isPending && isErrorResult(result, isError);
    const { text, parsed } = parseResultObject(result);

    const state: MarkerState = isPending ? 'pending' : errored ? 'error' : 'done';

    let label: React.ReactNode;
    if (errored) {
      label = `Failed: ${kind}`;
    } else if (isPending) {
      label = buildPendingLabel(kind, args);
    } else {
      label = buildDoneLabel(kind, args, parsed);
    }

    const body = state === 'done' ? buildBody(kind, parsed, text) : null;
    const expandable = body !== null;
    const tooltip = buildTooltip(kind, args);
    const icon = TOOL_ICONS[kind];

    const pill = (
      <MarkerPill
        icon={icon}
        state={state}
        expandable={expandable}
        open={open}
        onClick={toggle}
        testId={`chat-schedule-${kind.toLowerCase()}-pill`}
      >
        <span className="font-mono text-caption text-mf-text-3">{label}</span>
      </MarkerPill>
    );

    return (
      <MarkerWrap>
        {tooltip ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span>{pill}</span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-sm whitespace-pre-wrap">
              {tooltip}
            </TooltipContent>
          </Tooltip>
        ) : (
          pill
        )}
        {open && expandable && <MarkerBody>{body}</MarkerBody>}
      </MarkerWrap>
    );
  };
  Card.displayName = `SchedulePill_${kind}`;
  return Card;
}

export const ScheduleWakeupCard = buildScheduleCard('ScheduleWakeup');
export const CronCreateCard = buildScheduleCard('CronCreate');
export const CronDeleteCard = buildScheduleCard('CronDelete');
export const CronListCard = buildScheduleCard('CronList');
export const MonitorCard = buildScheduleCard('Monitor');

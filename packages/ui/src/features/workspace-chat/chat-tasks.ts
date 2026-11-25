/**
 * The daemon's task list of one chat, read while a tab in front shows one of its
 * agents: one request at a time, however many tabs ask. The last list stays
 * while it is asked for again, and stops counting as live with the connection,
 * or once it is too old while the daemon refuses another.
 */
import type { BackgroundTask } from '@qlan-ro/mainframe-types';
import { listBackgroundTasks } from '@/lib/api/background-tasks';

const RETRY_MS = 1_000;
const RETRY_MAX_MS = 10_000;
/** After this long a request is given up, and counts as refused. */
const ANSWER_MS = 15_000;
/** How long a list counts while the daemon refuses another. */
const CONFIRMED_MS = 30_000;

export interface ChatTasksState {
  /** Null until the daemon has listed them. */
  tasks: readonly BackgroundTask[] | null;
  /** The list still says what runs. */
  live: boolean;
}

export const NOTHING_LISTED: ChatTasksState = { tasks: null, live: true };

/** A settled row stays settled: a later list changes it only with a later run of the same task. */
function keepSettled(before: readonly BackgroundTask[], now: readonly BackgroundTask[]): BackgroundTask[] {
  const same = (a: BackgroundTask, b: BackgroundTask) => a.id === b.id && a.toolUseId === b.toolUseId;
  const kept = before.filter(
    (task) => task.status !== 'running' && !now.some((next) => same(next, task) && next.startedAt > task.startedAt),
  );
  return [...kept, ...now.filter((task) => !kept.some((settled) => same(settled, task)))];
}

type Timer = ReturnType<typeof setTimeout> | undefined;

class ChatTasks {
  state = NOTHING_LISTED;
  private readonly listeners = new Set<() => void>();
  private watchers = 0;
  private connected = true;
  private events: { seen: unknown } | null = null;
  private request: AbortController | null = null;
  private again = false;
  private refusals = 0;
  /** The request's limit, or the wait before the next. */
  private timer: Timer;
  private lost = false;
  private stale = false;
  private confirmedAt = -Infinity;
  private expiry: Timer;

  constructor(
    private readonly chatId: string,
    private readonly forget: () => void,
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size > 0) return;
      clearTimeout(this.expiry);
      this.forget();
    };
  }

  /** A tab of the chat's is in front. */
  watch(): () => void {
    this.watchers += 1;
    if (this.watchers === 1) this.start();
    return () => {
      this.watchers -= 1;
      if (this.watchers === 0) this.halt();
    };
  }

  setConnected(connected: boolean): void {
    if (connected === this.connected) return;
    this.connected = connected;
    if (connected) return this.start();
    this.halt();
    this.lost = true;
    this.publish();
  }

  /** The chat's background work, a new object per event. */
  setEvents(events: unknown): void {
    const before = this.events;
    this.events = { seen: events };
    if (before === null || before.seen === events || !this.asking) return;
    if (this.request !== null) this.again = true;
    else if (this.timer === undefined) this.run();
  }

  private get asking(): boolean {
    return this.connected && this.watchers > 0;
  }

  private start(): void {
    if (!this.asking) return;
    this.refusals = 0;
    this.run();
  }

  private halt(): void {
    this.request?.abort();
    this.request = null;
    this.clearTimer();
  }

  private clearTimer(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private run(): void {
    this.timer = undefined;
    const request = new AbortController();
    this.request = request;
    this.again = false;
    const settle = (): boolean => {
      if (this.request !== request) return false;
      this.request = null;
      this.clearTimer();
      return true;
    };
    const refuse = (error: unknown) => {
      if (settle()) this.refused(error);
    };
    this.timer = setTimeout(() => {
      refuse(new Error('No answer'));
      request.abort();
    }, ANSWER_MS);
    listBackgroundTasks(this.chatId, request.signal).then((tasks) => {
      if (settle()) this.listed(tasks);
    }, refuse);
  }

  private listed(tasks: readonly BackgroundTask[]): void {
    this.refusals = 0;
    this.lost = false;
    this.stale = false;
    this.confirmedAt = Date.now();
    clearTimeout(this.expiry);
    this.publish(keepSettled(this.state.tasks ?? [], tasks));
    if (this.again) this.run();
  }

  private refused(error: unknown): void {
    console.warn('[workspace-chat] could not list background tasks', error);
    this.timer = setTimeout(() => this.run(), Math.min(RETRY_MS * 2 ** this.refusals, RETRY_MAX_MS));
    this.refusals += 1;
    clearTimeout(this.expiry);
    const left = this.confirmedAt + CONFIRMED_MS - Date.now();
    if (left <= 0) this.expire();
    else this.expiry = setTimeout(() => this.expire(), left);
  }

  private expire(): void {
    this.stale = true;
    this.publish();
  }

  private publish(tasks = this.state.tasks): void {
    this.state = { tasks, live: !this.lost && !this.stale };
    for (const listener of this.listeners) listener();
  }
}

const open = new Map<string, ChatTasks>();

/** One per daemon and chat, for as long as something subscribes to it. */
const keyOf = (daemonId: string, chatId: string): string => JSON.stringify([daemonId, chatId]);

export function openChatTasks(daemonId: string, chatId: string): ChatTasks {
  const key = keyOf(daemonId, chatId);
  const found = open.get(key) ?? new ChatTasks(chatId, () => void open.delete(key));
  open.set(key, found);
  return found;
}

export const findChatTasks = (daemonId: string, chatId: string): ChatTasks | undefined =>
  open.get(keyOf(daemonId, chatId));

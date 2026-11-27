/**
 * after-first-paint — a once-per-page-load gate for reads that decorate the screen
 * (the branch name, the Changes count) but are not needed to draw it.
 *
 * Those reads run git on the daemon (branch, status, diff stat). At boot they landed
 * in the same burst as the history load for the chat being opened, and cost it daemon
 * CPU and a process spawn each. The gate opens, for good, two frames after the first
 * transcript is on screen. A screen with no transcript to show (a new chat, an empty
 * list, a list that failed) opens it after `FALLBACK_MS` from the first read that asks.
 * Once open it stays open, so a chat switch or a reload-free session never waits.
 */
import { useEffect, useSyncExternalStore } from 'react';

export const FALLBACK_MS = 800;

let isOpen = false;
let fallback: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function open(): void {
  if (isOpen) return;
  isOpen = true;
  if (fallback != null) clearTimeout(fallback);
  fallback = null;
  listeners.forEach((listener) => listener());
}

/** The first read that wants to wait starts the fallback clock. */
function armFallback(): void {
  if (isOpen || fallback != null) return;
  fallback = setTimeout(open, FALLBACK_MS);
}

/** The transcript is on screen; open after the frames that paint it. */
export function markFirstTranscriptShown(): void {
  if (isOpen) return;
  requestAnimationFrame(() => requestAnimationFrame(open));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** False until the first paint is behind us; true for the rest of the page's life. */
export function useAfterFirstPaint(): boolean {
  const painted = useSyncExternalStore(subscribe, () => isOpen);
  useEffect(armFallback, []);
  return painted;
}

/** Test seam: back to a fresh page load. */
export function resetAfterFirstPaint(): void {
  isOpen = false;
  if (fallback != null) clearTimeout(fallback);
  fallback = null;
}

/** Test seam: the gate as it is once the first paint has happened. */
export function openAfterFirstPaintForTests(): void {
  open();
}

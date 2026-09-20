/* PROTOTYPE — #357 in-memory note set shared across Preview/Source/CSV. */
import { useSyncExternalStore } from 'react';

export interface ProtoNote {
  id: string;
  startLine: number;
  endLine: number;
  content: string;
  text: string;
}

interface State {
  notes: ProtoNote[];
  /** id of the note whose widget is open (a draft is a note with text ''). */
  openId: string | null;
}

let state: State = { notes: [], openId: null };
const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((fn) => fn());
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useNotes(): State {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export const notes = {
  openDraft(startLine: number, endLine: number, content: string) {
    const existing = state.notes.find((n) => n.startLine === startLine && n.endLine === endLine);
    if (existing) {
      state = { ...state, openId: existing.id };
    } else {
      const id = `n${Date.now()}`;
      state = { notes: [...state.notes, { id, startLine, endLine, content, text: '' }], openId: id };
    }
    emit();
  },
  setText(id: string, text: string) {
    state = { ...state, notes: state.notes.map((n) => (n.id === id ? { ...n, text } : n)) };
    emit();
  },
  close(id: string) {
    const n = state.notes.find((x) => x.id === id);
    const keep = n && n.text.trim() !== '';
    state = { notes: keep ? state.notes : state.notes.filter((x) => x.id !== id), openId: null };
    emit();
  },
  remove(id: string) {
    state = { notes: state.notes.filter((x) => x.id !== id), openId: state.openId === id ? null : state.openId };
    emit();
  },
  clear() {
    state = { notes: [], openId: null };
    emit();
  },
};

export function noteFor(startLine: number, endLine: number): ProtoNote | undefined {
  return state.notes.find((n) => n.startLine === startLine && n.endLine === endLine);
}

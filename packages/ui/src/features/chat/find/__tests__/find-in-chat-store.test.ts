import { describe, it, expect, beforeEach } from 'vitest';
import { useFindInChatStore, type FindMatch } from '../find-in-chat-store';

const m = (charStart: number): FindMatch => ({ messageId: 'm1', partIndex: 0, charStart, charEnd: charStart + 2 });

beforeEach(() => {
  useFindInChatStore.setState({ isOpen: false, query: '', matches: [], activeIndex: 0 });
});

describe('useFindInChatStore', () => {
  it('open() sets isOpen true', () => {
    useFindInChatStore.getState().open();
    expect(useFindInChatStore.getState().isOpen).toBe(true);
  });

  it('close() resets all find state', () => {
    useFindInChatStore.setState({ isOpen: true, query: 'foo', matches: [m(0)], activeIndex: 1 });
    useFindInChatStore.getState().close();
    expect(useFindInChatStore.getState()).toMatchObject({ isOpen: false, query: '', matches: [], activeIndex: 0 });
  });

  it('setQuery() resets activeIndex to 0', () => {
    useFindInChatStore.setState({ activeIndex: 3 });
    useFindInChatStore.getState().setQuery('hello');
    expect(useFindInChatStore.getState().query).toBe('hello');
    expect(useFindInChatStore.getState().activeIndex).toBe(0);
  });

  it('setMatches() stores matches and resets activeIndex to 0', () => {
    useFindInChatStore.setState({ activeIndex: 2 });
    useFindInChatStore.getState().setMatches([m(0), m(5)]);
    expect(useFindInChatStore.getState().matches).toHaveLength(2);
    expect(useFindInChatStore.getState().activeIndex).toBe(0);
  });

  it('next() wraps around from last to first', () => {
    useFindInChatStore.setState({ matches: [m(0), m(5)], activeIndex: 1 });
    useFindInChatStore.getState().next();
    expect(useFindInChatStore.getState().activeIndex).toBe(0);
  });

  it('prev() wraps around from first to last', () => {
    useFindInChatStore.setState({ matches: [m(0), m(5)], activeIndex: 0 });
    useFindInChatStore.getState().prev();
    expect(useFindInChatStore.getState().activeIndex).toBe(1);
  });

  it('next()/prev() are no-ops when there are no matches', () => {
    useFindInChatStore.setState({ matches: [], activeIndex: 0 });
    useFindInChatStore.getState().next();
    expect(useFindInChatStore.getState().activeIndex).toBe(0);
    useFindInChatStore.getState().prev();
    expect(useFindInChatStore.getState().activeIndex).toBe(0);
  });
});

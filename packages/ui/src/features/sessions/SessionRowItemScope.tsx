/**
 * The single place a session row's `threadListItem` scope is constructed.
 *
 * A row is addressed by its stable `item.id`, but assistant-ui only ships a
 * by-INDEX provider (`ThreadListItemByIndexProvider`), so this is that provider
 * written against the `{ type: 'id' }` query the scope's own meta already
 * declares. `ThreadListItemPrimitive.Root/.Trigger` and every `useAuiState`
 * read below it resolve through this scope.
 *
 * `Derived` comes from `@assistant-ui/store` — `@assistant-ui/react` does not
 * re-export it — which is why the package depends on the store directly. A
 * SECOND `@assistant-ui/store` instance in the lockfile would make the provider
 * below write a different React context than the primitives read, and every
 * session row would break with no type error and no test failure. One resolved
 * instance is the standing requirement; `SessionRowItemScope.test.tsx` fails
 * loudly if it is ever violated.
 */
import type { PropsWithChildren } from 'react';
import { AuiConfig, AuiProvider, useAui } from '@assistant-ui/react';
import { Derived } from '@assistant-ui/store';

export function SessionRowItemScope({ id, children }: PropsWithChildren<{ id: string }>) {
  const aui = useAui();
  const config = AuiConfig({
    threadListItem: Derived({
      source: 'threads',
      query: { type: 'id', id },
      get: (client) => client.threads.item({ id }),
    }),
  });

  return (
    <AuiProvider extends={aui} config={config}>
      {children}
    </AuiProvider>
  );
}

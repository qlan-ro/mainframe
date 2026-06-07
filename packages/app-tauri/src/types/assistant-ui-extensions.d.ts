/**
 * Type augmentations for @assistant-ui/react.
 *
 * Declares internal helpers that exist at runtime in the @assistant-ui/react
 * package but are not part of the public TypeScript declaration surface.
 *
 * useThreadListRuntime is defined in
 * @assistant-ui/react/dist/legacy-runtime/hooks/AssistantContext.js as
 * `(opt) => useAssistantRuntime(opt)?.threads ?? null` but is not re-exported
 * from the package index. It is listed here so component code (and the
 * vi.mock factory in tests) can reference it with full type safety.
 */
import type { ThreadListRuntime } from '@assistant-ui/react';

declare module '@assistant-ui/react' {
  /**
   * Returns the ThreadListRuntime from the nearest AssistantRuntimeProvider,
   * or null if no provider is found.
   *
   * This is an internal helper from @assistant-ui/react that is not re-exported
   * from the public package index. In tests, it is intercepted by vi.mock.
   */
  export function useThreadListRuntime(): ThreadListRuntime | null;
}

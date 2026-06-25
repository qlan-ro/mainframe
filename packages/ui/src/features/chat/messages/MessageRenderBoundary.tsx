import React from 'react';

/**
 * Per-message error boundary.
 *
 * assistant-ui's `tapClientLookup` can throw "Index N out of bounds
 * (length: N)" during concurrent renders when the external messages array
 * shrinks between a parent's captured index and a descendant hook's read.
 * Scoping the failure to the affected message keeps the rest of the thread
 * visible; React recovers on the next stable render (`componentDidUpdate`
 * clears the error so the message re-renders once the store settles).
 *
 * Ported from the desktop renderer as defensive insurance — the cost is one
 * class component and a wrapper, the downside of omitting it is a single
 * message throw taking down the whole thread.
 */
export class MessageRenderBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error): void {
    console.warn('[message-render-boundary] message render failed', error.message);
  }

  componentDidUpdate(): void {
    if (this.state.hasError) this.setState({ hasError: false });
  }

  render(): React.ReactNode {
    return this.state.hasError ? null : this.props.children;
  }
}

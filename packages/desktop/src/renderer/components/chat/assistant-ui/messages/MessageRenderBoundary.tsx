import React from 'react';
import { createLogger } from '../../../../lib/logger';

const log = createLogger('renderer:message-render-boundary');

// Why a boundary here: assistant-ui's tapClientLookup can throw
// "Index N out of bounds (length: N)" during concurrent renders when the
// external messages array shrinks between a parent's captured index and a
// descendant hook's read. Scoping the failure to the affected message keeps
// the rest of the thread visible; React recovers on the next stable render.
export class MessageRenderBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error): void {
    log.warn('message render failed', { message: error.message });
  }

  componentDidUpdate(_prev: { children: React.ReactNode }): void {
    if (this.state.hasError) this.setState({ hasError: false });
  }

  render(): React.ReactNode {
    return this.state.hasError ? null : this.props.children;
  }
}

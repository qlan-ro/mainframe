import React from 'react';
import { getHost } from '../../lib/host';
import { ErrorState } from './ErrorState';

interface MfErrorBoundaryProps {
  children: React.ReactNode;
  onReset?: () => void;
}

interface MfErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
}

/**
 * Application-level error boundary.
 *
 * Catches synchronous render errors and displays the ErrorState fallback panel.
 * On catch it logs the full diagnostics (error stack + component stack) durably
 * through the host so packaged builds capture crashes even when the user can't
 * open devtools. The "Try again" button calls reset() to clear the error state,
 * re-rendering children. An optional onReset callback is called on each reset.
 */
export class MfErrorBoundary extends React.Component<MfErrorBoundaryProps, MfErrorBoundaryState> {
  state: MfErrorBoundaryState = { hasError: false, error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<MfErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    const componentStack = info.componentStack ?? null;
    this.setState({ componentStack });
    getHost().log('error', 'mf-error-boundary', error.message, {
      stack: error.stack ?? null,
      componentStack,
    });
  }

  reset = (): void => {
    this.setState({ hasError: false, error: null, componentStack: null });
    this.props.onReset?.();
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return <ErrorState error={this.state.error} componentStack={this.state.componentStack} onRetry={this.reset} />;
    }
    return this.props.children;
  }
}

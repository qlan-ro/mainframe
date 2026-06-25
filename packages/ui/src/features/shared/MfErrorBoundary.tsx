import React from 'react';
import { ErrorState } from './ErrorState';

interface MfErrorBoundaryProps {
  children: React.ReactNode;
  onReset?: () => void;
}

interface MfErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Application-level error boundary.
 *
 * Catches synchronous render errors and displays the ErrorState fallback panel.
 * The "Try again" button calls reset() to clear the error state, re-rendering
 * children. An optional onReset callback is called on each reset.
 */
export class MfErrorBoundary extends React.Component<MfErrorBoundaryProps, MfErrorBoundaryState> {
  state: MfErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): MfErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.warn('[mf-error-boundary] render error caught', error.message, info.componentStack);
  }

  reset = (): void => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return <ErrorState error={this.state.error} onRetry={this.reset} />;
    }
    return this.props.children;
  }
}

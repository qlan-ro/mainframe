/**
 * Behavior tests for PushNotificationCard — the transcript card for Claude's
 * `PushNotification` tool call (todo #293).
 *
 * Contract: the card shows the message Claude asked to be notified with, and
 * the CLI's own result text verbatim — Mainframe never rewrites it (AC9).
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PushNotificationCard } from '../PushNotificationCard';
import { makeToolPart, nestedVerticalScrollers } from './_part-fixture';

const CLI_RESULT = '{"message":"Ready for your review","pushSent":false,"disabledReason":"user_present"}';

describe('PushNotificationCard — message', () => {
  it('renders the message from args.message in the card body', () => {
    render(
      <PushNotificationCard
        {...makeToolPart({
          toolName: 'PushNotification',
          args: { message: 'Ready for your review', status: 'proactive' },
          result: CLI_RESULT,
        })}
      />,
    );
    fireEvent.click(screen.getByTestId('push-notification-card-trigger'));
    expect(screen.getByTestId('push-notification-card-message')).toHaveTextContent('Ready for your review');
  });

  it('renders the "Notify" verb', () => {
    render(
      <PushNotificationCard
        {...makeToolPart({
          toolName: 'PushNotification',
          args: { message: 'Ready for your review', status: 'proactive' },
          result: CLI_RESULT,
        })}
      />,
    );
    expect(screen.getByText('Notify')).toBeInTheDocument();
  });
});

describe('PushNotificationCard — result', () => {
  it('renders the CLI result text unmodified', () => {
    render(
      <PushNotificationCard
        {...makeToolPart({
          toolName: 'PushNotification',
          args: { message: 'Ready for your review', status: 'proactive' },
          result: CLI_RESULT,
        })}
      />,
    );
    fireEvent.click(screen.getByTestId('push-notification-card-trigger'));
    expect(screen.getByTestId('push-notification-card-result').textContent).toBe(CLI_RESULT);
  });

  it('renders no result element while the call is still in flight', () => {
    render(
      <PushNotificationCard
        {...makeToolPart({
          toolName: 'PushNotification',
          args: { message: 'Ready for your review', status: 'proactive' },
          result: undefined,
        })}
      />,
    );
    fireEvent.click(screen.getByTestId('push-notification-card-trigger'));
    expect(screen.queryByTestId('push-notification-card-result')).not.toBeInTheDocument();
    expect(screen.getByTestId('push-notification-card-message')).toHaveTextContent('Ready for your review');
  });

  it('renders the error body when the tool call failed', () => {
    render(
      <PushNotificationCard
        {...makeToolPart({
          toolName: 'PushNotification',
          args: { message: 'Ready for your review', status: 'proactive' },
          result: '<tool_use_error>no transport</tool_use_error>',
          isError: true,
        })}
      />,
    );
    fireEvent.click(screen.getByTestId('push-notification-card-trigger'));
    const body = screen.getByTestId('push-notification-card-error-body');
    expect(body).toHaveTextContent('no transport');
    expect(body).not.toHaveTextContent('<tool_use_error>');
  });
});

describe('PushNotificationCard — malformed input', () => {
  it('renders without crashing when args.message is missing', () => {
    render(<PushNotificationCard {...makeToolPart({ toolName: 'PushNotification', args: {} })} />);
    expect(screen.getByTestId('push-notification-card-root')).toBeInTheDocument();
    expect(screen.queryByTestId('push-notification-card-message')).not.toBeInTheDocument();
  });

  it('renders without crashing when args.message is not a string', () => {
    render(<PushNotificationCard {...makeToolPart({ toolName: 'PushNotification', args: { message: 42 } })} />);
    expect(screen.getByTestId('push-notification-card-root')).toBeInTheDocument();
    expect(screen.queryByTestId('push-notification-card-message')).not.toBeInTheDocument();
  });
});

describe('PushNotificationCard — layout', () => {
  it('nests no vertical scroll container (the thread viewport is the single overflow owner)', () => {
    const { container } = render(
      <PushNotificationCard
        {...makeToolPart({
          toolName: 'PushNotification',
          args: { message: 'A message long enough to wrap past two lines in the card body.' },
          result: CLI_RESULT,
        })}
      />,
    );
    fireEvent.click(screen.getByTestId('push-notification-card-trigger'));
    expect(nestedVerticalScrollers(container)).toHaveLength(0);
  });
});

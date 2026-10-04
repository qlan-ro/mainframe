import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { CompactFixture, fixtureMessage, fixtureTool } from './fixtures';

it('merges adjacent reads and opens original native details in order', () => {
  const message = fixtureMessage([
    fixtureTool(),
    fixtureTool({ toolCallId: 'read-b', args: { file_path: '/src/b.ts' }, result: 'const b = 2;' }),
  ]);
  render(<CompactFixture messages={[message]} rootId="merge" />);
  const toggle = screen.getByRole('button', { name: 'Read files' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByTestId('read-card-root')).toBeNull();
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole('button', { name: 'Read 2 files in /src' }));
  expect(screen.getAllByTestId('read-card-root')).toHaveLength(2);
  expect(screen.getAllByTestId('read-card-code-preview')[0]).toHaveTextContent('const a = 1;');
  expect(screen.getAllByTestId('read-card-code-preview')[1]).toHaveTextContent('const b = 2;');
});
it('retains prose boundaries and omits internal reasoning from mixed activity details', () => {
  render(
    <CompactFixture
      rootId="boundaries"
      messages={[
        fixtureMessage([
          { type: 'text', text: 'Before tools' },
          fixtureTool(),
          { type: 'reasoning', text: 'A private thought' },
          fixtureTool({ toolCallId: 'read-b' }),
          { type: 'text', text: 'After tools' },
        ]),
      ]}
    />,
  );
  expect(screen.getAllByRole('button', { name: 'Read files' })).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Read files' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText('A private thought')).toBeNull();
  expect(screen.getByText('Before tools')).toBeInTheDocument();
  expect(screen.getByText('After tools')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Read files' }));
  expect(screen.queryByText('A private thought')).toBeNull();
  expect(screen.getByRole('button', { name: 'Read /src/a.ts (2 reads)' })).toBeInTheDocument();
});
it('keeps failed rows collapsed and pending permission status explicit', () => {
  render(
    <CompactFixture
      rootId="statuses"
      pendingToolIds={['pending']}
      messages={[
        fixtureMessage(
          [
            fixtureTool({
              toolCallId: 'failed',
              isError: true,
              providerMetadata: { mainframe: { acpStatus: 'failed' } },
            }),
            fixtureTool({
              toolCallId: 'pending',
              result: undefined,
              providerMetadata: { mainframe: { acpStatus: 'in_progress' } },
            }),
          ],
          'message',
          true,
        ),
      ]}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Read files' }));
  expect(screen.getByRole('button', { name: /Failed to read/ })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('button', { name: /Waiting for approval/ })).toBeInTheDocument();
  expect(screen.queryByTestId('read-card-root')).toBeNull();
});

it('keeps images and prose in their original positions between activity groups', () => {
  const { container } = render(
    <CompactFixture
      rootId="image-order"
      messages={[
        fixtureMessage([
          { type: 'text', text: 'Before' },
          fixtureTool(),
          { type: 'image', image: 'data:image/png;base64,aGVsbG8=' },
          fixtureTool({ toolCallId: 'after-image' }),
          { type: 'text', text: 'After' },
        ]),
      ]}
    />,
  );
  const before = screen.getByText('Before');
  const after = screen.getByText('After');
  const image = container.querySelector('img')!;
  const tools = screen.getAllByRole('button', { name: 'Read files' });
  expect(before.compareDocumentPosition(tools[0]!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  expect(tools[0]!.compareDocumentPosition(image)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  expect(image.compareDocumentPosition(tools[1]!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  expect(tools[1]!.compareDocumentPosition(after)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
});

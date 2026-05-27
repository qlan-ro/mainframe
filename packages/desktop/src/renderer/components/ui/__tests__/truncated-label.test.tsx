import { describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { fireEvent, render } from '@testing-library/react';
import { TruncatedLabel } from '../truncated-label';

describe('<TruncatedLabel>', () => {
  it('renders the text', () => {
    const { getByText } = render(<TruncatedLabel text="hello world" />);
    expect(getByText('hello world')).toBeTruthy();
  });

  it('applies truncate and min-w-0 classes', () => {
    const { getByTestId } = render(<TruncatedLabel text="x" data-testid="tl" />);
    const el = getByTestId('tl');
    expect(el.className).toMatch(/\btruncate\b/);
    expect(el.className).toMatch(/\bmin-w-0\b/);
  });

  it('omits title attribute when title prop is not passed', () => {
    const { getByTestId } = render(<TruncatedLabel text="hello" data-testid="tl" />);
    expect(getByTestId('tl').hasAttribute('title')).toBe(false);
  });

  it('sets title attribute when title prop is passed', () => {
    const { getByTestId } = render(<TruncatedLabel text="hello" title="hello" data-testid="tl" />);
    expect(getByTestId('tl').getAttribute('title')).toBe('hello');
  });

  it('forwards data-testid', () => {
    const { getByTestId } = render(<TruncatedLabel text="x" data-testid="my-label" />);
    expect(getByTestId('my-label')).toBeTruthy();
  });

  it('forwards arbitrary HTML props', () => {
    const onClick = vi.fn();
    const { getByTestId } = render(
      <TruncatedLabel text="x" data-testid="tl" onClick={onClick} aria-describedby="d1" />,
    );
    const el = getByTestId('tl');
    fireEvent.click(el);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(el.getAttribute('aria-describedby')).toBe('d1');
  });

  it('forwards ref to the rendered DOM node', () => {
    const ref = createRef<HTMLElement>();
    render(<TruncatedLabel text="x" ref={ref} data-testid="tl" />);
    expect(ref.current).toBeInstanceOf(HTMLElement);
    expect(ref.current?.tagName.toLowerCase()).toBe('span');
  });

  it('renders as a div when as="div"', () => {
    const { getByTestId } = render(<TruncatedLabel text="x" as="div" data-testid="tl" />);
    expect(getByTestId('tl').tagName.toLowerCase()).toBe('div');
  });
});

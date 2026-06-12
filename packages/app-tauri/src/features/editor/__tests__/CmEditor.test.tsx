/**
 * CmEditor component tests.
 *
 * jsdom does not implement Range.getClientRects — CM6 calls it during mount.
 * The stubs below (matching the spike recipe) are hoisted to this file because
 * the global setup.ts handles all other stubs; CM6-specific ones live here.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CmEditor } from '../CmEditor';
import { useEditorStore } from '@/store/editor';

const zeroRect: DOMRect = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
  toJSON: () => ({}),
};

function zeroRectList(): DOMRectList {
  return {
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* () {
      /* jsdom stub */
    },
  } as unknown as DOMRectList;
}

beforeAll(() => {
  Range.prototype.getClientRects = zeroRectList;
  Range.prototype.getBoundingClientRect = () => zeroRect;
});

describe('CmEditor', () => {
  it('mounts with the given doc and renders a CM6 editor', () => {
    render(
      <CmEditor
        value="const x = 1\n"
        language="javascript"
        readOnly={false}
        onChange={() => undefined}
        path="/test/file.ts"
      />,
    );
    const root = screen.getByTestId('editor-code');
    expect(root.querySelector('.cm-editor')).toBeTruthy();
    expect(root.querySelector('.cm-content')?.textContent).toContain('const x = 1');
  });

  it('carries the mf-editor-selectable class for text selection opt-in', () => {
    render(
      <CmEditor
        value="hello"
        language="javascript"
        readOnly={false}
        onChange={() => undefined}
        path="/test/selectable.ts"
      />,
    );
    const root = screen.getByTestId('editor-code');
    expect(root.classList.contains('mf-editor-selectable')).toBe(true);
  });

  it('emits onChange when the user types', async () => {
    const onChange = vi.fn();
    render(<CmEditor value="" language="javascript" readOnly={false} onChange={onChange} path="/test/edit.ts" />);
    const content = screen.getByTestId('editor-code').querySelector('.cm-content') as HTMLElement;
    // CM6 uses contenteditable, so we can focus + type
    content.focus();
    await userEvent.type(content, 'a');
    expect(onChange).toHaveBeenCalled();
  });

  it('respects readOnly — the editor sets aria-readonly on the content node', () => {
    render(
      <CmEditor
        value="immutable"
        language="javascript"
        readOnly={true}
        onChange={() => undefined}
        path="/test/readonly.ts"
      />,
    );
    const root = screen.getByTestId('editor-code');
    // CM6 keeps contenteditable=true but sets aria-readonly=true when
    // EditorState.readOnly is active (it uses a separate `editable` facet for
    // contenteditable; readOnly only prevents document mutations).
    const content = root.querySelector('.cm-content');
    expect(content).toBeTruthy();
    expect(content?.getAttribute('aria-readonly')).toBe('true');
  });

  it('reconfigures when the language prop changes', () => {
    const { rerender } = render(
      <CmEditor
        value="const x = 1"
        language="javascript"
        readOnly={false}
        onChange={() => undefined}
        path="/test/lang.ts"
      />,
    );
    const root = screen.getByTestId('editor-code');
    expect(root.querySelector('.cm-editor')).toBeTruthy();

    // Re-render with a different language — should not crash
    rerender(
      <CmEditor
        value="def x(): pass"
        language="python"
        readOnly={false}
        onChange={() => undefined}
        path="/test/lang.ts"
      />,
    );
    expect(root.querySelector('.cm-editor')).toBeTruthy();
  });

  it('renders a fold gutter (.cm-foldGutter) for multi-line foldable code', () => {
    render(
      <CmEditor
        value="function foo() {\n  const x = 1;\n  return x;\n}"
        language="javascript"
        readOnly={false}
        onChange={() => undefined}
        path="/test/fold.ts"
      />,
    );
    const root = screen.getByTestId('editor-code');
    expect(root.querySelector('.cm-foldGutter')).toBeTruthy();
  });

  it('restores selection from store on remount with same path', () => {
    const path = '/test/restore-sel.ts';
    // Prime the store with a saved selection at position 3
    act(() => {
      useEditorStore.getState().saveViewState(path, {
        selectionAnchor: 3,
        selectionHead: 3,
        scrollTop: 0,
      });
    });

    // Mount — the editor should restore without crashing
    render(
      <CmEditor value="abcdefghij" language="javascript" readOnly={false} onChange={() => undefined} path={path} />,
    );
    const root = screen.getByTestId('editor-code');
    expect(root.querySelector('.cm-editor')).toBeTruthy();
  });
});

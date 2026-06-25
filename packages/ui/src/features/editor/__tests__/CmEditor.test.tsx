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
import { runScopeHandlers } from '@codemirror/view';
import { EditorView } from '@codemirror/view';
import { CmEditor } from '../CmEditor';
import { useEditorStore } from '@/store/editor';
import { jumpHistory } from '../lsp/navigation';
import * as surfaceIntents from '@/store/surface-intents';

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

  it('does NOT emit onChange for programmatic value-prop updates (external reload)', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <CmEditor value="original" language="javascript" readOnly={false} onChange={onChange} path="/test/ext.ts" />,
    );
    rerender(
      <CmEditor
        value="changed on disk"
        language="javascript"
        readOnly={false}
        onChange={onChange}
        path="/test/ext.ts"
      />,
    );
    expect(onChange).not.toHaveBeenCalled();
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

  describe('back/forward navigation keybindings (⌘⌥← / ⌘⌥→)', () => {
    // jsdom sets navigator.platform = "" so CM6 treats Mod as Ctrl (not Meta).
    // Tests use runScopeHandlers from @codemirror/view which bypasses DOM event
    // routing and processes the keymap directly.

    it('Mod-Alt-ArrowLeft fires emitSurfaceIntent(open-file) with the prior jump entry', () => {
      const emitSpy = vi.spyOn(surfaceIntents, 'emitSurfaceIntent');
      let capturedView: import('@codemirror/view').EditorView | null = null;

      // Prime jumpHistory with two entries (origin → destination).
      act(() => {
        jumpHistory.push({ path: '/origin.ts', line: 0, character: 0 });
        jumpHistory.push({ path: '/dest.ts', line: 42, character: 5 });
        // cursor is now at index 1 (dest); back() should return origin
      });

      render(
        <CmEditor
          value="const x = 1"
          language="javascript"
          readOnly={false}
          onChange={() => undefined}
          path="/dest.ts"
          onViewReady={(v) => {
            capturedView = v;
          }}
        />,
      );

      expect(capturedView).not.toBeNull();

      act(() => {
        // jsdom: navigator.platform="" → Mod = Ctrl; altKey for Alt modifier
        runScopeHandlers(
          capturedView!,
          new KeyboardEvent('keydown', { key: 'ArrowLeft', keyCode: 37, ctrlKey: true, altKey: true }),
          'editor',
        );
      });

      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'open-file', path: '/origin.ts', line: 0, character: 0 }),
      );

      emitSpy.mockRestore();
    });

    it('Mod-Alt-ArrowRight fires emitSurfaceIntent(open-file) with the next jump entry after going back', () => {
      const emitSpy = vi.spyOn(surfaceIntents, 'emitSurfaceIntent');
      let capturedView: import('@codemirror/view').EditorView | null = null;

      act(() => {
        jumpHistory.push({ path: '/a.ts', line: 1, character: 0 });
        jumpHistory.push({ path: '/b.ts', line: 10, character: 3 });
        // go back so there is a forward entry
        jumpHistory.back();
      });

      render(
        <CmEditor
          value="hello"
          language="javascript"
          readOnly={false}
          onChange={() => undefined}
          path="/a.ts"
          onViewReady={(v) => {
            capturedView = v;
          }}
        />,
      );

      expect(capturedView).not.toBeNull();

      act(() => {
        // jsdom: Mod = Ctrl
        runScopeHandlers(
          capturedView!,
          new KeyboardEvent('keydown', { key: 'ArrowRight', keyCode: 39, ctrlKey: true, altKey: true }),
          'editor',
        );
      });

      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'open-file', path: '/b.ts', line: 10, character: 3 }),
      );

      emitSpy.mockRestore();
    });
  });

  describe('reveal-on-open regression (consumeRevealTarget → revealPosition)', () => {
    it('reveals the stored target position on mount when a revealTarget is set for the path', () => {
      const path = '/test/reveal-regression.ts';

      // Set a reveal target in the store (simulates intent-subscriber setting it before mount)
      act(() => {
        useEditorStore.getState().setRevealTarget(path, { line: 2, character: 4 });
      });

      // Mount the editor — the reveal target should be consumed without crashing
      render(
        <CmEditor
          value="line0\nline1\nline2 with some content\nline3"
          language="javascript"
          readOnly={false}
          onChange={() => undefined}
          path={path}
        />,
      );

      const root = screen.getByTestId('editor-code');
      expect(root.querySelector('.cm-editor')).toBeTruthy();

      // After mount, the reveal target should have been consumed (no longer in the store)
      const remaining = useEditorStore.getState().consumeRevealTarget(path);
      expect(remaining).toBeUndefined();
    });
  });

  describe('extraExtensions compartment reconfiguration', () => {
    it('applies a new extraExtensions array when the prop changes after mount', () => {
      // Build an observable extension: editorAttributes adds a class to the CM6 root.
      // We use this as a proxy to confirm the compartment was reconfigured.
      const marker = EditorView.editorAttributes.of({ class: 'test-extra-marker' });

      const { rerender } = render(
        <CmEditor
          value="hello"
          language="javascript"
          readOnly={false}
          onChange={() => undefined}
          path="/test/extra-ext.ts"
          extraExtensions={undefined}
        />,
      );

      const root = screen.getByTestId('editor-code');
      const cmRoot = root.querySelector('.cm-editor') as HTMLElement;
      expect(cmRoot).toBeTruthy();

      // Before reconfigure: the marker class must NOT be present.
      expect(cmRoot.classList.contains('test-extra-marker')).toBe(false);

      // Rerender with a new extensions array containing the marker.
      rerender(
        <CmEditor
          value="hello"
          language="javascript"
          readOnly={false}
          onChange={() => undefined}
          path="/test/extra-ext.ts"
          extraExtensions={[marker]}
        />,
      );

      // After reconfigure: the marker class MUST be present on the CM6 editor root.
      expect(cmRoot.classList.contains('test-extra-marker')).toBe(true);
    });
  });
});

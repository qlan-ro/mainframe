import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { useTabsStore } from '../../store/tabs';
import { useProjectsStore } from '../../store/projects';
import { getActiveProjectId } from '../../hooks/useActiveProjectId.js';

// Configure Monaco workers for Electron (no CDN access).
self.MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  },
};

// Configure @monaco-editor/react to use the local bundle instead of CDN.
loader.config({ monaco });

// Disable the built-in TypeScript diagnostics — the editor displays files from
// arbitrary projects and the TS worker has no access to node_modules, tsconfig,
// or Node.js type definitions, so its errors are misleading.
monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: false,
});
monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: false,
});

// Define the mainframe-dark theme once globally.
monaco.editor.defineTheme('mainframe-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6b7280', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'c084fc' },
    { token: 'string', foreground: '86efac' },
    { token: 'number', foreground: 'fbbf24' },
    { token: 'type', foreground: '67e8f9' },
    { token: 'function', foreground: '93c5fd' },
    { token: 'variable', foreground: 'f4f4f5' },
    { token: 'operator', foreground: 'a1a1aa' },
  ],
  colors: {
    'editor.background': '#191a1c',
    'editor.foreground': '#e4e4e7',
    'editorLineNumber.foreground': '#52525b',
    'editorLineNumber.activeForeground': '#a1a1aa',
    'editor.selectionBackground': '#3b82f630',
    'editor.lineHighlightBackground': '#ffffff08',
    'diffEditor.insertedTextBackground': '#00000000',
    'diffEditor.removedTextBackground': '#00000000',
    'diffEditor.insertedLineBackground': '#243d30',
    'diffEditor.removedLineBackground': '#4d2c2c',
    'editorGutter.background': '#191a1c',
    'scrollbarSlider.background': '#52525b40',
    'scrollbarSlider.hoverBackground': '#71717a60',
    // Peek view (Go To Definition / References)
    'peekView.border': '#3b82f650',
    'peekViewEditor.background': '#1e1f22',
    'peekViewResult.background': '#16171a',
    'peekViewTitle.background': '#1e1f22',
    'peekViewTitleLabel.foreground': '#e4e4e7',
    'peekViewTitleDescription.foreground': '#71717a',
    'peekViewResult.selectionBackground': '#3b82f630',
    'peekViewResult.selectionForeground': '#e4e4e7',
    'peekViewEditor.matchHighlightBackground': '#3b82f640',
    'peekViewResult.matchHighlightBackground': '#3b82f640',
    'peekViewResult.fileForeground': '#a1a1aa',
    'peekViewResult.lineForeground': '#71717a',
  },
});

// Register a global editor opener so Ctrl+Click on resolved imports
// opens the file in our editor panel instead of Monaco's inline peek.
monaco.editor.registerEditorOpener({
  openCodeEditor(_source, resource, selectionOrPosition) {
    if (resource.scheme !== 'file') return false;
    let filePath = resource.path;
    if (!filePath) return false;

    // Convert absolute filesystem paths to project-relative paths.
    // The API expects relative paths; absolute paths cause 403 errors.
    const activeProjectId = getActiveProjectId();
    const { projects } = useProjectsStore.getState();
    const projectPath = projects.find((p) => p.id === activeProjectId)?.path;
    if (projectPath && filePath.startsWith(projectPath)) {
      filePath = filePath.slice(projectPath.length).replace(/^\//, '');
    } else {
      filePath = filePath.replace(/^\//, '');
    }

    // Extract line and column from the selection or position.
    const line = selectionOrPosition
      ? 'startLineNumber' in selectionOrPosition
        ? selectionOrPosition.startLineNumber
        : selectionOrPosition.lineNumber
      : undefined;
    const column = selectionOrPosition
      ? 'startColumn' in selectionOrPosition
        ? selectionOrPosition.startColumn
        : selectionOrPosition.column
      : undefined;

    useTabsStore.getState().openEditorTab(filePath, undefined, line, column);
    return true;
  },
});

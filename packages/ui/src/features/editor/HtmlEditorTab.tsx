/**
 * HtmlEditorTab — an .html/.htm file in the workspace surface with a
 * Preview/Source toggle. Source = the CM6 editor (html highlighting, editable);
 * Preview = the live buffer rendered in a sandboxed `srcdoc` iframe.
 *
 * The iframe's empty `sandbox` gives the document an opaque origin and blocks
 * its scripts, forms and top-level navigation, so an untrusted file renders as
 * static markup and styles. Relative assets (`./style.css`, images) don't
 * resolve inside `srcdoc`; "Open in browser" hands the file on disk to the
 * default browser for a full-fidelity view.
 *
 * Like MarkdownEditorTab, one persistent ViewerShell provides the header and
 * footer in both modes, with the toggle in its `actions` slot.
 */
import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { CmEditorWithComments } from './inline-comments/CmEditorWithComments';
import { useFileTabNotes } from './inline-comments/use-file-notes';
import { ViewerShell } from '@/features/viewers/ViewerShell';
import { Segmented } from '@/features/viewers/Segmented';
import { formatBytes } from '@/features/viewers/viewer-status';
import { useNativeFileAction } from '@/features/viewers/viewer-file-path';

type Mode = 'edit' | 'preview';

interface HtmlEditorTabProps {
  value: string;
  path: string;
  onChange: (value: string) => void;
  onSave?: (value: string) => void;
  readOnly?: boolean;
}

export function HtmlEditorTab({ value, path, onChange, onSave, readOnly = false }: HtmlEditorTabProps) {
  // Opens rendered by default, like markdown and the other special viewers.
  const [mode, setMode] = useState<Mode>('preview');
  const { model, submitBar } = useFileTabNotes({ filePath: path });
  const openInBrowser = useNativeFileAction(path, 'open');

  const status = `HTML · ${formatBytes(new TextEncoder().encode(value).length)}`;

  const actions = (
    <>
      <Segmented
        value={mode}
        onChange={(id) => setMode(id as Mode)}
        options={[
          { id: 'preview', label: 'Preview', testId: 'html-mode-preview' },
          { id: 'edit', label: 'Source', testId: 'html-mode-edit' },
        ]}
      />
      <Hint label={openInBrowser.disabledReason ?? 'Open in browser'}>
        <Button
          data-testid="html-open-in-browser"
          variant="ghost"
          size="icon-xs"
          aria-label="Open in browser"
          disabled={openInBrowser.disabledReason !== null}
          onClick={() => void openInBrowser.run()}
        >
          <ExternalLink />
        </Button>
      </Hint>
    </>
  );

  return (
    <ViewerShell path={path} status={status} actions={actions}>
      <div className="flex min-h-0 flex-1 flex-col">
        {submitBar}
        <div className="min-h-0 flex-1">
          {mode === 'edit' ? (
            <CmEditorWithComments
              value={value}
              language="html"
              readOnly={readOnly}
              onChange={onChange}
              onSave={onSave}
              path={path}
              filePath={path}
              model={model}
            />
          ) : (
            <iframe
              data-testid="html-preview-frame"
              title={`Preview of ${path.split('/').pop() ?? path}`}
              sandbox=""
              srcDoc={value}
              className="size-full border-0 bg-white"
            />
          )}
        </div>
      </div>
    </ViewerShell>
  );
}

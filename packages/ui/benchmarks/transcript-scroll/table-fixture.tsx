import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MarkdownTable, MarkdownTh, MarkdownTd } from '../../src/features/chat/parts/markdown-table';
import '../../src/styles/globals.css';

const initial =
  '| Item | Current assessment | Evidence |\n| --- | --- | --- |\n' +
  '| Cost report | Still open, checking the reported behavior against the current implementation. | Link |\n';
const suffix = '| Authorization | Investigation continues | ' + 'wide-evidence-identifier-'.repeat(12) + ' |';
const components = { table: MarkdownTable, th: MarkdownTh, td: MarkdownTd };

export function TableFixture() {
  const [text, setText] = useState(initial);
  return (
    <div style={{ width: 640 }}>
      <button id="stream" onClick={() => setText(initial + suffix)}>
        Append evidence row
      </button>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

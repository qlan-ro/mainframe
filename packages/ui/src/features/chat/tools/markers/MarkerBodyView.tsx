import { Prose } from '../../messages/turn/Prose';
import type { MarkerBody } from '../../view-model/turn/marker-facts';
import { BackgroundOutput } from '../bodies/BackgroundOutput';
import { CodeBody } from '../bodies/CodeBody';
import { BodyNote, KeyValue, Surface } from '../bodies/Surface';
import { parseCodeLines } from '../bodies/code-lines';

function SkillBody({ body, id }: { body: Extract<MarkerBody, { type: 'skill' }>; id: string }) {
  return (
    <>
      {body.path && (
        <BodyNote>
          Loaded <code className="mf-tr-mono">{body.path}</code>
        </BodyNote>
      )}
      {body.args && <BodyNote>Arguments: {body.args}</BodyNote>}
      <CodeBody id={id} path="SKILL.md" lines={parseCodeLines(body.content)} testId="chat-skill-content" />
    </>
  );
}

function Jobs({ body }: { body: Extract<MarkerBody, { type: 'jobs' }> }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {body.jobs.map((job) => (
        <li key={job.id} className="min-w-0">
          <span className="mf-tr-mono">{job.id}</span> {job.schedule}{' '}
          <span className="text-muted-foreground">· {job.cadence}</span>
          {job.prompt && <p className="text-muted-foreground">{job.prompt}</p>}
        </li>
      ))}
    </ul>
  );
}

export function MarkerBodyView({ body, id }: { body: MarkerBody; id: string }) {
  switch (body.type) {
    case 'markdown':
      return <Prose text={body.text} />;
    case 'skill':
      return <SkillBody body={body} id={id} />;
    case 'jobs':
      return <Jobs body={body} />;
    case 'output':
      return <BackgroundOutput toolCallId={id} command={body.command} launch={body.text} />;
    case 'error':
      return (
        <Surface>
          <KeyValue label="Error" tone="fail">
            {body.text}
          </KeyValue>
        </Surface>
      );
    case 'note':
      return (
        <>
          <p className="wrap-break-word whitespace-pre-wrap">{body.text}</p>
          {body.detail && <p className="mf-tr-meta mt-1 text-muted-foreground">{body.detail}</p>}
        </>
      );
  }
}

import { useState } from 'react';
import type { CreatedExternalMcpClient } from '@qlan-ro/mainframe-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props {
  created: CreatedExternalMcpClient;
  endpoint: string;
  onDone: () => void;
}

export function ClientKey({ created, endpoint, onDone }: Props) {
  return (
    <section className="grid min-w-0 gap-3 rounded-md border border-border p-4" data-testid="external-clients-key">
      <h2 className="text-sm font-semibold">Connect {created.client.name}</h2>
      <p className="text-sm text-muted-foreground">
        Save this key in your client's MCP settings. Mainframe shows it only once.
      </p>
      <CopyField id="external-client-endpoint" label="Server URL" value={endpoint} />
      <CopyField id="external-client-key" label="Client key" value={created.token} secret />
      <p className="text-sm text-muted-foreground">
        Use HTTP transport and an Authorization header with the value Bearer followed by your key.
      </p>
      <Button className="justify-self-start" onClick={onDone} data-testid="external-clients-done">
        Done
      </Button>
    </section>
  );
}

interface FieldProps {
  id: string;
  label: string;
  value: string;
  secret?: boolean;
}
function CopyField({ id, label, value, secret }: FieldProps) {
  const [message, setMessage] = useState('');
  const [visible, setVisible] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setMessage('Copied.');
    } catch {
      setMessage('Could not copy. Reveal the field, then select and copy it.');
    }
  }
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={secret && !visible ? 'password' : 'text'} autoComplete="off" readOnly value={value} />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => void copy()} data-testid={`${id}-copy`}>
          Copy {secret ? 'key' : 'URL'}
        </Button>
        {secret && (
          <Button variant="ghost" aria-pressed={visible} onClick={() => setVisible((v) => !v)}>
            {visible ? 'Hide key' : 'Reveal key'}
          </Button>
        )}
        <span role="status" className="text-sm text-muted-foreground">
          {message}
        </span>
      </div>
    </div>
  );
}

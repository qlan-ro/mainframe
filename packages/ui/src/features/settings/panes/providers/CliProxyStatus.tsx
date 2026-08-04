import type { AdapterModel, ProviderConfig, ProviderConfigUpdate } from '@qlan-ro/mainframe-types';
import { cn } from '../../../../lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@v2/components/ui/select';

const CLIPROXY_GROUP = 'CLIProxyAPI';
const AUTO = '__auto__';

/** The proxy speaks bare ids; `cliproxy/` is Mainframe's namespace for them. */
function bareId(id: string): string {
  const slash = id.indexOf('/');
  return slash === -1 ? id : id.slice(slash + 1);
}

interface CliProxyStatusProps {
  adapterId: string;
  models: AdapterModel[];
  config: ProviderConfig;
  onChange: (partial: ProviderConfigUpdate) => void;
}

/**
 * Read-only status for a local CLIProxyAPI, plus the one override worth exposing.
 *
 * Detection is derived from the adapter catalog rather than a status route, so this
 * row can never disagree with the model picker: the models are here exactly when the
 * last probe reached the proxy. Neither the config path nor the API key is rendered —
 * the key is read at spawn and never leaves the daemon.
 */
export function CliProxyStatus({ adapterId, models, config, onChange }: CliProxyStatusProps) {
  const proxyModels = models.filter((m) => m.group === CLIPROXY_GROUP);
  const detected = proxyModels.length > 0;

  return (
    <div data-testid={`settings-${adapterId}-cliproxy`} className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{CLIPROXY_GROUP}</span>
      <div className="flex items-center gap-1.5">
        <span className={cn('size-1.5 rounded-full', detected ? 'bg-success' : 'bg-muted-foreground')} />
        <span data-testid={`settings-${adapterId}-cliproxy-status`} className="text-sm text-foreground">
          {detected ? `${proxyModels.length} models available` : 'Not detected'}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {detected
          ? 'These models appear in the model picker under their own section.'
          : 'Start it with `brew services start cliproxyapi`. Set MAINFRAME_CLIPROXY_CONFIG if its config lives outside the standard paths.'}
      </p>

      {detected && (
        <label className="flex flex-col gap-1.5 pt-1.5">
          <span className="text-xs font-medium text-muted-foreground">Background model</span>
          <Select
            value={config.cliproxySmallFastModel ?? AUTO}
            onValueChange={(v) => onChange({ cliproxySmallFastModel: v === AUTO ? '' : v })}
          >
            <SelectTrigger size="sm" className="w-full" data-testid={`settings-${adapterId}-cliproxy-small-fast-model`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO} data-testid={`settings-${adapterId}-cliproxy-small-fast-model-option-auto`}>
                Auto (fastest available)
              </SelectItem>
              {proxyModels.map((m) => (
                <SelectItem
                  key={m.id}
                  value={bareId(m.id)}
                  data-testid={`settings-${adapterId}-cliproxy-small-fast-model-option-${m.id}`}
                >
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            What the CLI uses for summaries, compaction, and its other background calls on a proxy session — the proxy
            has no Haiku to fall back on.
          </p>
        </label>
      )}
    </div>
  );
}

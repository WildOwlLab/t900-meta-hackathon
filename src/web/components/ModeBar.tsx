import type { ConfigResponse } from '../../shared/api';
import { FIXTURE_NOTICE, type Mode } from '../../shared/types';

interface Props {
  config: ConfigResponse | null;
  mode: Mode;
  onMode: (mode: Mode) => void;
}

export function ModeBar({ config, mode, onMode }: Props) {
  const live = config?.live;
  return (
    <section aria-labelledby="mode-heading">
      <h2 id="mode-heading">Mode</h2>
      <div role="radiogroup" aria-labelledby="mode-heading" className="choices">
        <label className="choice">
          <input type="radio" name="mode" value="fixture" checked={mode === 'fixture'} onChange={() => onMode('fixture')} />
          <span>
            <strong>Fixture</strong> Offline. Hand-written outputs for the built-in examples. Nothing is sent anywhere.
          </span>
        </label>
        <label className="choice">
          <input
            type="radio"
            name="mode"
            value="live"
            checked={mode === 'live'}
            disabled={!live?.available}
            onChange={() => onMode('live')}
          />
          <span>
            <strong>Live</strong> Sends the text you approve to a model provider.
          </span>
        </label>
      </div>

      {live && !live.available && (
        <p className="note" data-testid="live-unavailable">
          {live.reason}
        </p>
      )}
      {live?.available && (
        <p className="note" data-testid="live-configured">
          Live is configured: model <code>{live.model}</code> at <code>{live.destination}</code>.
        </p>
      )}

      {mode === 'fixture' ? (
        <p className="banner" role="status" data-testid="mode-banner" data-mode="fixture">
          <strong>Fixture mode.</strong> {FIXTURE_NOTICE} Nothing is sent to any provider.
        </p>
      ) : (
        <p className="banner live" role="status" data-testid="mode-banner" data-mode="live">
          <strong>Live mode.</strong> Text you approve is sent to <code>{live?.available ? live.destination : 'the provider'}</code>.
        </p>
      )}
    </section>
  );
}

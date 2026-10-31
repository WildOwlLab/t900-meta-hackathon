import { describe, expect, it } from 'vitest';
import { displayEndpoint, loadConfig, resolveChatUrl } from '../../src/server/config';

const resolved = (raw: string): string => {
  const result = resolveChatUrl(raw);
  if (!result.ok) throw new Error(result.error);
  return result.url.href;
};

describe('resolveChatUrl', () => {
  it('turns the base URLs supplied by the project owner into chat completions URLs (string handling only, no network)', () => {
    expect(resolved('https://api.fireworks.ai/inference/v1')).toBe('https://api.fireworks.ai/inference/v1/chat/completions');
    expect(resolved('https://bridge.baseten.co/v1')).toBe('https://bridge.baseten.co/v1/chat/completions');
  });

  it('handles trailing slashes and a bare host', () => {
    expect(resolved('https://x.test/v1/')).toBe('https://x.test/v1/chat/completions');
    expect(resolved('https://x.test/v1///')).toBe('https://x.test/v1/chat/completions');
    expect(resolved('https://x.test')).toBe('https://x.test/chat/completions');
    expect(resolved('https://x.test/')).toBe('https://x.test/chat/completions');
  });

  it('leaves a URL that already ends in /chat/completions alone, without doubling it', () => {
    expect(resolved('https://x.test/v1/chat/completions')).toBe('https://x.test/v1/chat/completions');
    expect(resolved('https://x.test/v1/chat/completions/')).toBe('https://x.test/v1/chat/completions');
  });

  it('keeps the query string for the call, drops the fragment, and never displays the query', () => {
    const result = resolveChatUrl('https://x.test/v1?api-version=2&token=SECRET#frag');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.url.href).toBe('https://x.test/v1/chat/completions?api-version=2&token=SECRET');
    expect(displayEndpoint(result.url)).toBe('https://x.test/v1/chat/completions');
  });

  it('requires https, allowing http only for localhost', () => {
    expect(resolveChatUrl('http://x.test/v1').ok).toBe(false);
    expect(resolveChatUrl('ftp://x.test/v1').ok).toBe(false);
    expect(resolveChatUrl('http://localhost:9000/v1').ok).toBe(true);
    expect(resolveChatUrl('http://127.0.0.1:9000/v1').ok).toBe(true);
  });

  it('rejects embedded credentials and things that are not URLs', () => {
    expect(resolveChatUrl('https://user:pass@x.test/v1').ok).toBe(false);
    expect(resolveChatUrl('https://user@x.test/v1').ok).toBe(false);
    expect(resolveChatUrl('not a url').ok).toBe(false);
    expect(resolveChatUrl('').ok).toBe(false);
  });
});

describe('loadConfig', () => {
  const full = { META_API_KEY: 'SECRETKEY-1', META_API_URL: 'https://x.test/v1?token=Q', META_MODEL: 'some/model' };

  it('with nothing set: live is off, and the reason names the three variables', () => {
    const config = loadConfig({});
    expect(config.live.available).toBe(false);
    if (config.live.available) return;
    for (const name of ['META_API_KEY', 'META_API_URL', 'META_MODEL']) expect(config.live.reason).toContain(name);
    expect(config.responseFormat).toBe('json_schema');
    expect(config.model).toBeNull();
  });

  it('treats empty and whitespace-only values as unset', () => {
    const config = loadConfig({ META_API_KEY: '', META_API_URL: '   ', META_MODEL: '\t' });
    expect(config.live.available).toBe(false);
    expect(config.model).toBeNull();
  });

  it('with only some variables set: live is off and the reason lists exactly the missing ones', () => {
    const config = loadConfig({ META_API_KEY: 'SECRETKEY-1' });
    expect(config.live.available).toBe(false);
    if (config.live.available) return;
    expect(config.live.reason).toContain('META_API_URL');
    expect(config.live.reason).toContain('META_MODEL');
    expect(config.live.reason).not.toContain('META_API_KEY');
  });

  it('with everything set: live is available and shows only safe details', () => {
    const config = loadConfig(full);
    expect(config.live.available).toBe(true);
    if (!config.live.available) return;
    expect(config.live.settings.destination).toBe('https://x.test/v1/chat/completions');
    expect(config.live.settings.model).toBe('some/model');
    expect(config.live.settings.responseFormat).toBe('json_schema');
    expect(config.model).toBe('some/model');
  });

  it('accepts json_object and rejects anything else, turning live off with a reason', () => {
    const ok = loadConfig({ ...full, META_RESPONSE_FORMAT: 'json_object' });
    expect(ok.responseFormat).toBe('json_object');
    expect(ok.live.available && ok.live.settings.responseFormat).toBe('json_object');

    const bad = loadConfig({ ...full, META_RESPONSE_FORMAT: 'yaml' });
    expect(bad.live.available).toBe(false);
    if (!bad.live.available) expect(bad.live.reason).toContain('json_schema, json_object');
    expect(bad.responseFormat).toBe('json_schema');
  });

  it('turns live off when the URL is invalid, and says why', () => {
    const config = loadConfig({ ...full, META_API_URL: 'http://x.test/v1' });
    expect(config.live.available).toBe(false);
    if (!config.live.available) expect(config.live.reason).toContain('https');
  });

  it('never puts the key, or a URL query, in any reason string', () => {
    const cases = [
      loadConfig({ META_API_KEY: 'SECRETKEY-1' }),
      loadConfig({ ...full, META_API_URL: 'http://x.test/v1?token=Q' }),
      loadConfig({ ...full, META_RESPONSE_FORMAT: 'yaml' }),
    ];
    for (const config of cases) {
      expect(config.live.available).toBe(false);
      if (!config.live.available) {
        expect(config.live.reason).not.toContain('SECRETKEY-1');
        expect(config.live.reason).not.toContain('token=Q');
      }
    }
  });
});

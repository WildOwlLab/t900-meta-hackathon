import { describe, expect, it } from 'vitest';
import { buildPlan, describePlan, type DevPlan } from '../../scripts/dev';
import { STUB_BASE_URL, STUB_KEY } from '../e2e/support/constants';

const ROOT = '/repo';
const REAL_KEY = 'REALKEY-should-never-reach-the-ui-or-the-stub';

const plan = (argv: string[], env: Record<string, string | undefined> = {}): DevPlan => {
  const result = buildPlan(argv, env, ROOT);
  if (typeof result === 'string') throw new Error(result);
  return result;
};
const named = (p: DevPlan, name: string) => p.processes.find((spec) => spec.name === name)!;

describe('npm run dev', () => {
  it('starts the API and the UI, and nothing else', () => {
    const p = plan([]);
    expect(p.processes.map((spec) => spec.name)).toEqual(['api', 'web']);
    expect(p.stub).toBe(false);
  });

  it('runs the API through tsx and the UI through Vite, both with node directly (no shell)', () => {
    const p = plan([]);
    expect(named(p, 'api').args.slice(0, 2)).toEqual(['--import', 'tsx']);
    expect(named(p, 'api').args.at(-1)).toMatch(/src[\\/]server[\\/]main\.ts$/);
    expect(named(p, 'web').args[0]).toMatch(/node_modules[\\/]vite[\\/]bin[\\/]vite\.js$/);
    expect(named(p, 'web').args).toContain('--strictPort');
  });

  it('uses the default ports, and wires the UI proxy to the API port', () => {
    const p = plan([]);
    expect([p.apiPort, p.webPort]).toEqual([8787, 5173]);
    expect(named(p, 'api').env.PORT).toBe('8787');
    expect(named(p, 'web').env.API_PORT).toBe('8787');
    expect(named(p, 'web').args).toContain('5173');
  });

  it('honours PORT and WEB_PORT, and ignores nonsense values', () => {
    const custom = plan([], { PORT: '9000', WEB_PORT: '4000' });
    expect([custom.apiPort, custom.webPort]).toEqual([9000, 4000]);
    expect(named(custom, 'web').env.API_PORT).toBe('9000');
    for (const bad of ['abc', '0', '-5', '70000', '1.5', '']) {
      expect(plan([], { PORT: bad, WEB_PORT: bad })).toMatchObject({ apiPort: 8787, webPort: 5173 });
    }
  });

  it('rejects unknown arguments', () => {
    expect(buildPlan(['--nope'], {}, ROOT)).toMatch(/Unknown argument "--nope"/);
    expect(buildPlan(['--stub', '--other'], {}, ROOT)).toMatch(/Unknown argument "--other"/);
  });
});

describe('provider settings stay with the API', () => {
  const env = { META_API_KEY: REAL_KEY, META_API_URL: 'https://api.provider.test/v1', META_MODEL: 'm', META_RESPONSE_FORMAT: 'json_object' };

  it('passes the real settings to the API, and none of them to the UI', () => {
    const p = plan([], env);
    expect(named(p, 'api').env.META_API_KEY).toBe(REAL_KEY);
    for (const name of ['META_API_KEY', 'META_API_URL', 'META_MODEL', 'META_RESPONSE_FORMAT']) {
      expect(named(p, 'web').env[name], name).toBeUndefined();
    }
  });

  it('never puts a key on a command line, where it would show in the process list', () => {
    for (const argv of [[], ['--stub']]) {
      expect(JSON.stringify(plan(argv, env).processes.map((spec) => spec.args))).not.toContain(REAL_KEY);
    }
  });

  it('does not change the environment it is given', () => {
    const copy = { ...env };
    plan(['--stub'], copy);
    expect(copy).toEqual(env);
  });
});

describe('npm run dev -- --stub', () => {
  it('adds the stub provider first, then the API and the UI', () => {
    expect(plan(['--stub']).processes.map((spec) => spec.name)).toEqual(['stub', 'api', 'web']);
  });

  it('points live mode at the stub with the made-up key, even if real settings are present', () => {
    const p = plan(['--stub'], { META_API_KEY: REAL_KEY, META_API_URL: 'https://api.provider.test/v1', META_MODEL: 'real-model' });
    const api = named(p, 'api').env;
    expect(api.META_API_KEY).toBe(STUB_KEY);
    expect(api.META_API_URL).toBe(STUB_BASE_URL);
    expect(api.META_MODEL).toBe('stub-model');
    expect(JSON.stringify(p.processes)).not.toContain(REAL_KEY);
  });

  it('gives the stub and the UI no provider settings at all', () => {
    const p = plan(['--stub'], { META_API_KEY: REAL_KEY });
    for (const name of ['stub', 'web']) expect(named(p, name).env.META_API_KEY, name).toBeUndefined();
  });
});

describe('the start-up banner', () => {
  it('says fixture is the default and live is off when nothing is configured, and says why', () => {
    const lines = describePlan(plan([])).join('\n');
    expect(lines).toContain('http://localhost:5173');
    expect(lines).toContain('http://127.0.0.1:8787');
    expect(lines).toContain('Fixture mode: available, and the default');
    expect(lines).toMatch(/Live mode:\s+off\. Set .*META_API_KEY/);
    expect(lines).not.toContain('off. Live mode is off');
    expect(lines).not.toContain('Stub provider');
  });

  it('says plainly that the stub is not a model', () => {
    const lines = describePlan(plan(['--stub'])).join('\n');
    expect(lines).toContain('NOT a model');
    expect(lines).toMatch(/Live mode:\s+available \(http:\/\/127\.0\.0\.1:9101\/v1\/chat\/completions\)/);
  });

  it('never prints the key', () => {
    const lines = describePlan(plan([], { META_API_KEY: REAL_KEY, META_API_URL: 'https://api.provider.test/v1', META_MODEL: 'm' })).join('\n');
    expect(lines).not.toContain(REAL_KEY);
    expect(lines).toContain('https://api.provider.test/v1/chat/completions');
  });
});

/**
 * `npm run dev` starts everything needed to try the app in one command:
 *   - the API on 127.0.0.1:8787 (src/server/main.ts), loopback only
 *   - the web UI on http://localhost:5173 (Vite), which proxies /api to the API
 *
 * `npm run dev -- --stub` also starts a stub provider on 127.0.0.1:9101 and points live mode at it with
 * a made-up key. That lets you try the live path with no key and no network. The stub is NOT a model:
 * it only has hand-written answers for the built-in examples and one custom case.
 *
 * Settings: PORT (API, default 8787), WEB_PORT (UI, default 5173), and the META_* variables for live mode.
 * Provider variables are passed to the API process only, never to the UI or the stub.
 *
 * Processes are started with `node` directly (no shell), so this behaves the same on macOS, Linux and Windows.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { loadConfig, type Env } from '../src/server/config';
import { STUB_BASE_URL, STUB_KEY, STUB_PORT } from '../tests/e2e/support/constants';

export interface ProcessSpec {
  name: 'stub' | 'api' | 'web';
  /** Arguments for `node`. */
  args: string[];
  env: Env;
}

export interface DevPlan {
  processes: ProcessSpec[];
  apiPort: number;
  webPort: number;
  stub: boolean;
  /** The environment the API will see, used to describe which modes are available. */
  apiEnv: Env;
}

const DEFAULT_API_PORT = 8787;
const DEFAULT_WEB_PORT = 5173;
const PROVIDER_VARIABLES = ['META_API_KEY', 'META_API_URL', 'META_MODEL', 'META_RESPONSE_FORMAT'] as const;

const port = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : fallback;
};

/** A copy of `env` with every provider variable removed, for processes that have no use for them. */
function withoutProvider(env: Env): Env {
  const copy: Env = { ...env };
  for (const name of PROVIDER_VARIABLES) delete copy[name];
  return copy;
}

export function buildPlan(argv: string[], env: Env, root: string): DevPlan | string {
  const unknown = argv.filter((arg) => arg !== '--stub');
  if (unknown.length > 0) return `Unknown argument "${unknown[0]}". Usage: npm run dev [-- --stub]`;
  const stub = argv.includes('--stub');

  const apiPort = port(env.PORT, DEFAULT_API_PORT);
  const webPort = port(env.WEB_PORT, DEFAULT_WEB_PORT);

  // With --stub the API is pointed at the local stub, whatever the shell has set.
  const apiEnv: Env = {
    ...env,
    PORT: String(apiPort),
    ...(stub ? { META_API_KEY: STUB_KEY, META_API_URL: STUB_BASE_URL, META_MODEL: 'stub-model', META_RESPONSE_FORMAT: '' } : {}),
  };

  const tsx = ['--import', 'tsx'];
  const processes: ProcessSpec[] = [];
  if (stub) {
    processes.push({ name: 'stub', args: [...tsx, join(root, 'tests', 'e2e', 'support', 'stub-provider.ts')], env: withoutProvider(env) });
  }
  processes.push({ name: 'api', args: [...tsx, join(root, 'src', 'server', 'main.ts')], env: apiEnv });
  processes.push({
    name: 'web',
    args: [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(webPort), '--strictPort'],
    env: { ...withoutProvider(env), API_PORT: String(apiPort) },
  });

  return { processes, apiPort, webPort, stub, apiEnv };
}

export function describePlan(plan: DevPlan): string[] {
  const live = loadConfig(plan.apiEnv).live;
  return [
    'T900 Evidence Check (development)',
    `  UI    http://localhost:${plan.webPort}`,
    `  API   http://127.0.0.1:${plan.apiPort} (this machine only)`,
    '  Fixture mode: available, and the default. Output is hand-written and says so.',
    live.available
      ? `  Live mode:    available (${live.settings.destination}), never selected for you`
      : `  Live mode:    ${live.reason.replace(/^Live mode is off\.\s*/, 'off. ')}`,
    ...(plan.stub ? [`  Stub provider on 127.0.0.1:${STUB_PORT}. It is NOT a model: it only has hand-written answers for the built-in examples.`] : []),
    '  Press Ctrl+C to stop.',
    '',
  ];
}

async function main(): Promise<number> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const plan = buildPlan(process.argv.slice(2), process.env, process.cwd());
  if (typeof plan === 'string') {
    console.error(plan);
    return 2;
  }
  for (const line of describePlan(plan)) console.log(line);

  let stopping = false;
  const children = plan.processes.map((spec) => {
    const child = spawn(process.execPath, spec.args, { env: spec.env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [child.stdout, child.stderr]) {
      createInterface({ input: stream }).on('line', (line) => console.log(`[${spec.name}] ${line}`));
    }
    return { spec, child };
  });

  return new Promise<number>((resolve) => {
    const stop = (code: number) => {
      if (stopping) return;
      stopping = true;
      for (const { child } of children) child.kill();
      setTimeout(() => resolve(code), 300);
    };
    for (const { spec, child } of children) {
      child.on('error', (error) => {
        console.error(`[${spec.name}] could not start: ${error.message}`);
        stop(1);
      });
      child.on('exit', (code, signal) => {
        if (stopping) return;
        console.error(`[${spec.name}] stopped (${code ?? signal}). Stopping the rest. Is the port already in use?`);
        stop(code && code > 0 ? code : 1);
      });
    }
    process.on('SIGINT', () => stop(0));
    process.on('SIGTERM', () => stop(0));
  });
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) void main().then((code) => process.exit(code));

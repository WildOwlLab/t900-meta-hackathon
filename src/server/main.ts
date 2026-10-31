import { existsSync } from 'node:fs';
import { createApp } from './app';
import { loadConfig } from './config';
import { listen } from './listen';

// Variables already set in the environment win over the file (including empty ones).
if (existsSync('.env')) process.loadEnvFile('.env');

const port = Number(process.env.PORT) || 8787;
const app = createApp({ env: process.env });
const config = loadConfig(process.env);

listen(app, port, (actual) => {
  console.log(`API listening on http://127.0.0.1:${actual}`);
  console.log('Fixture mode: available (default).');
  console.log(config.live.available ? `Live mode: available (${config.live.settings.destination}).` : config.live.reason);
});

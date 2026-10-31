import { get } from 'node:http';
import type { AddressInfo } from 'node:net';
import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { LISTEN_HOST, listen } from '../../src/server/listen';
import { makeApp } from './helpers';

const servers: Array<ReturnType<typeof listen>> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

async function start() {
  const server = listen(makeApp(), 0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  return { server, port: (server.address() as AddressInfo).port };
}

const status = (port: number) =>
  new Promise<number>((resolve, reject) => {
    get({ host: '127.0.0.1', port, path: '/api/health' }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    }).on('error', reject);
  });

describe('the server only listens on loopback', () => {
  it('binds to 127.0.0.1', async () => {
    expect(LISTEN_HOST).toBe('127.0.0.1');
    const { server } = await start();
    expect((server.address() as AddressInfo).address).toBe('127.0.0.1');
  });

  it('serves on loopback', async () => {
    const { port } = await start();
    expect(await status(port)).toBe(200);
  });

  it('refuses connections arriving on any other interface of this machine', async () => {
    const { port } = await start();
    const external = Object.values(networkInterfaces())
      .flat()
      .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined && !entry.internal && entry.family === 'IPv4')
      .map((entry) => entry.address);

    for (const address of external) {
      const outcome = await new Promise<string>((resolve) => {
        const socket = connect({ host: address, port, timeout: 2_000 });
        socket.once('connect', () => {
          socket.destroy();
          resolve('connected');
        });
        socket.once('timeout', () => {
          socket.destroy();
          resolve('timeout');
        });
        socket.once('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? 'error'));
      });
      expect(outcome, `connecting to ${address}:${port}`).toBe('ECONNREFUSED');
    }
    // On a machine with no external interface this loop probes nothing; the bind-address test above still applies.
  });
});

import { get } from 'node:http';
import type { AddressInfo } from 'node:net';
import { connect, createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { LISTEN_HOST, listen } from '../../src/server/listen';
import { makeApp } from './helpers';

const servers: Array<{ close(callback: () => void): unknown }> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
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

const PROBE_TIMEOUT_MS = 2_000;

/**
 * Try to open a TCP connection and report what happened: 'connected', 'timeout', or the error code.
 * Always closes the socket, and always answers exactly once.
 */
function probe(host: string, port: number): Promise<string> {
  return new Promise<string>((resolve) => {
    const socket = connect({ host, port, timeout: PROBE_TIMEOUT_MS });
    const finish = (outcome: string) => {
      socket.destroy();
      resolve(outcome);
    };
    socket.once('connect', () => finish('connected'));
    socket.once('timeout', () => finish('timeout'));
    socket.once('error', (error: NodeJS.ErrnoException) => finish(error.code ?? 'error'));
  });
}

/**
 * Outcomes that prove nothing answered on that address.
 *
 * Linux and macOS refuse at once (ECONNREFUSED). Windows often does not answer a connection to an address with
 * nothing listening, so the attempt times out instead, and a disconnected or virtual adapter (VPN, Hyper-V, WSL)
 * can report the network or host as unreachable. All of those mean the same thing: no connection was made.
 *
 * The one outcome that must NEVER be accepted is 'connected'. That is what a server listening on every interface
 * would produce, and it is exactly the mistake this test exists to catch.
 */
const NOT_SERVING = ['ECONNREFUSED', 'timeout', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH'] as const;
const isNotServing = (outcome: string): boolean => (NOT_SERVING as readonly string[]).includes(outcome);

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
      .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined && !entry.internal && String(entry.family) in { IPv4: 1, 4: 1 })
      .map((entry) => entry.address);

    // All interfaces are probed at once. A Windows machine can have several virtual adapters, and probing them one
    // after another could take longer than the test is allowed to run.
    const results = await Promise.all(external.map(async (address) => ({ address, outcome: await probe(address, port) })));
    for (const { address, outcome } of results) {
      expect(outcome, `connecting to ${address}:${port} must not succeed`).not.toBe('connected');
      expect(isNotServing(outcome), `connecting to ${address}:${port} gave "${outcome}"`).toBe(true);
    }
    // On a machine with no external interface nothing is probed. The bind-address test above still applies.
  }, 20_000);
});

describe('the probe behind that test', () => {
  it('reports a connection when something is listening, so a "refused" result is not just the probe failing', async () => {
    const open = createServer((socket) => socket.end());
    servers.push(open);
    await new Promise<void>((resolve) => open.listen(0, '0.0.0.0', resolve));
    const { port } = open.address() as AddressInfo;
    expect(await probe('127.0.0.1', port)).toBe('connected');
  });

  it('reports a refusal for a port nothing listens on', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const { port } = closed.address() as AddressInfo;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    expect(isNotServing(await probe('127.0.0.1', port))).toBe(true);
  });

  it('accepts a refusal, a timeout, and an unreachable network as proof that nothing is serving', () => {
    for (const outcome of ['ECONNREFUSED', 'timeout', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH']) {
      expect(isNotServing(outcome), outcome).toBe(true);
    }
  });

  it('never accepts a successful connection, or an outcome it does not recognise', () => {
    for (const outcome of ['connected', 'ECONNRESET', 'EACCES', 'error', '', 'refused', 'TIMEOUT']) {
      expect(isNotServing(outcome), JSON.stringify(outcome)).toBe(false);
    }
  });
});

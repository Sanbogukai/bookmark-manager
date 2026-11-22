// The SSRF guard. Refusals are checked with the real settings; the fetching itself is checked
// against a small server on 127.0.0.1, with the guard loosened to allow only that address.

// Vitest's test functions.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// A plain HTTP server to fetch from.
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
// Its address type, to read the port it was given.
import type { AddressInfo } from 'node:net';
// The code under test.
import { RefusedUrlError, UnreadablePageError, createSafeFetch, isBlockedAddress } from '../src/safeFetch.ts';

// The one address the loosened guard allows: the test server's.
const LOOPBACK = '127.0.0.1';
// The test fetcher's limits, small so the tests are quick.
const TEST_TIMEOUT_MS = 300;
const TEST_MAX_BYTES = 1024;
// How many times bigger than the limit the large page is.
const OVERSIZE = 8;

// What the test server answers on each path.
const routes: Record<string, (res: ServerResponse, port: number) => void> = {
  '/page': (res) => {
    res.writeHead(OK_STATUS, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<title>Test page</title>');
  },
  '/hop': (res) => {
    res.writeHead(FOUND_STATUS, { location: '/page' });
    res.end();
  },
  '/to-private': (res, port) => {
    res.writeHead(FOUND_STATUS, { location: `http://10.0.0.5:${port}/` });
    res.end();
  },
  '/loop': (res) => {
    res.writeHead(FOUND_STATUS, { location: '/loop' });
    res.end();
  },
  '/json': (res) => {
    res.writeHead(OK_STATUS, { 'content-type': 'application/json' });
    res.end('{}');
  },
  '/broken': (res) => {
    res.writeHead(SERVER_ERROR_STATUS, { 'content-type': 'text/html' });
    res.end('<title>Oops</title>');
  },
  '/big': (res) => {
    res.writeHead(OK_STATUS, { 'content-type': 'text/html' });
    res.end(`<title>Big</title>${'x'.repeat(TEST_MAX_BYTES * OVERSIZE)}`);
  },
  // Never answers, to trip the timeout.
  '/slow': () => {},
};

// The status codes the server sends.
const OK_STATUS = 200;
const FOUND_STATUS = 302;
const SERVER_ERROR_STATUS = 500;

// The test server: each request goes to its route, or gets a 404.
const NOT_FOUND_STATUS = 404;
const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const route = routes[req.url ?? ''];
  if (route) route(res, (server.address() as AddressInfo).port);
  else res.writeHead(NOT_FOUND_STATUS).end();
});

// The server's base URL, set once it is listening.
const base = { url: '', port: '' };

beforeAll(async () => {
  // Port 0 asks the system for any free port.
  await new Promise<void>((resolve) => server.listen(0, LOOPBACK, resolve));
  const { port } = server.address() as AddressInfo;
  Object.assign(base, { url: `http://${LOOPBACK}:${port}`, port: String(port) });
});

afterAll(() => {
  // Drops the open slow request too, so close() does not wait for it.
  server.closeAllConnections();
  server.close();
});

// A fetcher that allows only the test server.
function testFetch() {
  return createSafeFetch({
    isBlocked: (address) => address !== LOOPBACK,
    allowedPorts: [base.port],
    timeoutMs: TEST_TIMEOUT_MS,
    maxBytes: TEST_MAX_BYTES,
  });
}

describe('isBlockedAddress', () => {
  // Each address and whether it should be blocked.
  const cases: [string, boolean][] = [
    ['127.0.0.1', true],
    ['10.1.2.3', true],
    ['172.16.0.1', true],
    ['192.168.1.1', true],
    ['169.254.169.254', true],
    ['100.64.0.1', true],
    ['0.0.0.0', true],
    ['::1', true],
    ['::ffff:127.0.0.1', true],
    ['::ffff:8.8.8.8', false],
    ['fd00::1', true],
    ['fe80::1', true],
    ['not an address', true],
    ['93.184.215.14', false],
    ['8.8.8.8', false],
    ['2606:4700::1111', false],
  ];
  it.each(cases)('%s blocked: %s', (address, blocked) => {
    expect(isBlockedAddress(address)).toBe(blocked);
  });
});

describe('createSafeFetch with the real settings', () => {
  const fetchPage = createSafeFetch();
  // Each URL refused before any request leaves the machine.
  const refused = [
    'http://127.0.0.1/',
    'http://10.0.0.5/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'ftp://example.com/',
    'http://example.com:22/',
    'not a url',
    // A name, refused when the lookup at connect time finds 127.0.0.1 or ::1.
    'http://localhost/',
  ];
  it.each(refused)('refuses %s', async (url) => {
    await expect(fetchPage(url)).rejects.toBeInstanceOf(RefusedUrlError);
  });
});

describe('createSafeFetch against a local server', () => {
  it('reads a page and follows a redirect, reporting where it ended up', async () => {
    const page = await testFetch()(`${base.url}/hop`);
    expect(page).toEqual({ url: `${base.url}/page`, html: '<title>Test page</title>' });
  });

  it('refuses a redirect to a blocked address', async () => {
    await expect(testFetch()(`${base.url}/to-private`)).rejects.toBeInstanceOf(RefusedUrlError);
  });

  it('gives up on a redirect loop', async () => {
    await expect(testFetch()(`${base.url}/loop`)).rejects.toThrow(new UnreadablePageError('Too many redirects'));
  });

  it('refuses a page that is not HTML', async () => {
    await expect(testFetch()(`${base.url}/json`)).rejects.toThrow(new UnreadablePageError('That link is not a web page'));
  });

  it('reports an error status as unreadable', async () => {
    await expect(testFetch()(`${base.url}/broken`)).rejects.toBeInstanceOf(UnreadablePageError);
  });

  it('times out on a page that never answers', async () => {
    await expect(testFetch()(`${base.url}/slow`)).rejects.toBeInstanceOf(UnreadablePageError);
  });

  it('reads no more than the size limit', async () => {
    const page = await testFetch()(`${base.url}/big`);
    expect(page.html.startsWith('<title>Big</title>')).toBe(true);
    expect(Buffer.byteLength(page.html)).toBeLessThanOrEqual(TEST_MAX_BYTES);
  });
});

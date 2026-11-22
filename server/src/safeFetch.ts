// The SSRF guard. A server that fetches any URL a visitor types can be pointed at addresses
// only the server can reach: its own localhost, the cloud's metadata service at
// 169.254.169.254, or a private network. This module fetches a page while refusing all of
// those, and limits how long and how much it reads.

// BlockList matches addresses against ranges; isIP tells whether text is an IP address.
import { BlockList, type LookupFunction, isIP } from 'node:net';
// The system's name lookup, the same one Node uses by default.
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
// undici is the HTTP client behind Node's fetch. Its Agent lets this module replace the
// name lookup used when a connection is opened.
import { Agent, fetch } from 'undici';

// A URL the guard will not fetch: wrong scheme or port, or a blocked address. The route
// answers 400, since the request itself is at fault.
export class RefusedUrlError extends Error {}

// A page that could not be read: no answer, a timeout, an error status, or not HTML. The
// route answers 422.
export class UnreadablePageError extends Error {}

// A fetched page: the address it was finally read from (after redirects) and its HTML.
export interface FetchedPage {
  url: string;
  html: string;
}

// Anything that turns a URL into a page. The app uses the safe fetcher below; route tests
// pass a fake, so no test reaches the internet.
export type PageFetcher = (url: string) => Promise<FetchedPage>;

// Settings, each with a safe default. Tests loosen isBlocked and allowedPorts to talk to a
// small server on 127.0.0.1, and shorten the timeout.
export interface SafeFetchOptions {
  isBlocked?: (address: string) => boolean;
  allowedPorts?: string[];
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

// Give up on a page after 5 seconds, counting every redirect.
const TIMEOUT_MS = 5000;
// Read at most 512 KB; the <head>, where the title and meta tags live, comes well before that.
const MAX_BYTES = 524_288;
// Follow at most 3 redirects.
const MAX_REDIRECTS = 3;
// The URL's port is '' when it is the scheme's default (80 for http, 443 for https).
const DEFAULT_PORTS = ['', '80', '443'];
// The status codes that mean "the page is at the Location header instead".
const MOVED_PERMANENTLY = 301;
const FOUND = 302;
const SEE_OTHER = 303;
const TEMPORARY_REDIRECT = 307;
const PERMANENT_REDIRECT = 308;
const REDIRECT_STATUSES = new Set([MOVED_PERMANENTLY, FOUND, SEE_OTHER, TEMPORARY_REDIRECT, PERMANENT_REDIRECT]);

// What isIP returns for each kind of address (0 means "not an address").
const IPV4 = 4;
const IPV6 = 6;

// Address ranges no preview may reach, in CIDR form: the network, a slash, and how many
// leading bits must match.
const BLOCKED_IPV4 = [
  '0.0.0.0/8', // "this network", including the unspecified 0.0.0.0
  '10.0.0.0/8', // private
  '100.64.0.0/10', // carrier-grade NAT, shared inside an ISP
  '127.0.0.0/8', // loopback: this machine
  '169.254.0.0/16', // link-local, including the cloud metadata service
  '172.16.0.0/12', // private
  '192.0.0.0/24', // IETF protocol assignments
  '192.168.0.0/16', // private
  '198.18.0.0/15', // benchmarking
  '224.0.0.0/4', // multicast
  '240.0.0.0/4', // reserved, including the broadcast address
];
const BLOCKED_IPV6 = [
  '::/128', // unspecified
  '::1/128', // loopback
  '64:ff9b::/96', // NAT64, which can map to any IPv4 address, private ones included
  '2001:db8::/32', // documentation
  'fc00::/7', // unique local: the IPv6 private range
  'fe80::/10', // link-local
  'ff00::/8', // multicast
];

// IPv4-mapped addresses such as ::ffff:127.0.0.1 need no entry of their own: BlockList checks
// them against the IPv4 ranges. Listing ::ffff:0:0/96 would block every IPv4 address, because
// BlockList maps the other way too.

// The ranges above in one list Node can check addresses against. Each CIDR is split at the
// slash into the network and the prefix length.
const BLOCKED = new BlockList();
const addRange = (family: 'ipv4' | 'ipv6') => (cidr: string) => {
  const [network = '', prefix = ''] = cidr.split('/');
  BLOCKED.addSubnet(network, Number(prefix), family);
};
BLOCKED_IPV4.forEach(addRange('ipv4'));
BLOCKED_IPV6.forEach(addRange('ipv6'));

// Whether an address is in a blocked range. Text that is not an address at all is blocked too.
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === IPV4) return BLOCKED.check(address, 'ipv4');
  if (family === IPV6) return BLOCKED.check(address, 'ipv6');
  return true;
}

// The error a blocked address raises while connecting. It is a RefusedUrlError, so the route
// answers 400 just as for a URL refused before connecting.
class BlockedAddressError extends RefusedUrlError {}

// A name lookup that refuses blocked addresses. It runs when the connection is opened, not
// before, so the address checked is the address used. Checking first and connecting later
// would allow DNS rebinding: a name that resolves to a public address for the check and to a
// private one a moment later for the fetch.
function guardedLookup(isBlocked: (address: string) => boolean): LookupFunction {
  return (hostname, options, callback) => {
    // Asks for every address, so none can hide behind a safe first answer.
    dnsLookup(hostname, { ...options, all: true }, (err, addresses: LookupAddress[]) => {
      if (err) {
        callback(err, '');
        return;
      }
      const blocked = addresses.find((entry) => isBlocked(entry.address));
      if (blocked) {
        callback(new BlockedAddressError(`${hostname} points at a blocked address`), '');
        return;
      }
      // Answers in the shape the caller asked for: every address, or just the first.
      const [first] = addresses;
      if (options.all) callback(null, addresses);
      else if (first) callback(null, first.address, first.family);
      else callback(new UnreadablePageError(`${hostname} has no address`), '');
    });
  };
}

// The URL as an object, or a RefusedUrlError if it is not one the guard will fetch.
function checkUrl(url: URL, settings: Required<SafeFetchOptions>): URL {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new RefusedUrlError('Only http and https links can be previewed');
  }
  if (!settings.allowedPorts.includes(url.port)) {
    throw new RefusedUrlError('Only the standard web ports can be previewed');
  }
  // A literal address never goes through a name lookup, so it is checked here. IPv6
  // addresses appear in brackets in a URL ([::1]); the check wants them without.
  const host = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
  if (isIP(host) !== 0 && settings.isBlocked(host)) {
    throw new RefusedUrlError('That address is not allowed');
  }
  return url;
}

// Reads the body piece by piece until it ends or maxBytes have arrived, then cancels the rest
// of the download. Stopping early is fine: the head is near the top. Each call reads one
// piece and hands the pieces so far to the next call.
async function readUpTo(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  maxBytes: number,
  received: Uint8Array[] = [],
  size = 0,
): Promise<Uint8Array[]> {
  if (size >= maxBytes) {
    await reader.cancel();
    return received;
  }
  const { done, value } = await reader.read();
  if (done) return received;
  return readUpTo(reader, maxBytes, [...received, value], size + value.byteLength);
}

// The body as text, at most maxBytes of it, decoded as UTF-8, which nearly every page uses.
// The body is typed by what is used, a reader, since undici's stream type differs from the
// global one.
async function readLimited(
  body: { getReader(): ReadableStreamDefaultReader<Uint8Array> } | null,
  maxBytes: number,
): Promise<string> {
  if (body === null) return '';
  const pieces = await readUpTo(body.getReader(), maxBytes);
  return Buffer.concat(pieces).subarray(0, maxBytes).toString('utf8');
}

// Whether an error, or the error that caused it, was raised by the guard.
function isRefusal(err: unknown): boolean {
  if (err instanceof RefusedUrlError) return true;
  // undici reports connection failures as TypeError('fetch failed') with the real error as its cause.
  return err instanceof Error && err.cause instanceof RefusedUrlError;
}

// Builds a fetcher with the given settings.
export function createSafeFetch(options: SafeFetchOptions = {}): PageFetcher {
  // The defaults, with anything the caller passed winning.
  const settings: Required<SafeFetchOptions> = {
    isBlocked: isBlockedAddress,
    allowedPorts: DEFAULT_PORTS,
    timeoutMs: TIMEOUT_MS,
    maxBytes: MAX_BYTES,
    maxRedirects: MAX_REDIRECTS,
    ...options,
  };
  // Every connection this fetcher opens resolves names through the guarded lookup.
  const agent = new Agent({ connect: { lookup: guardedLookup(settings.isBlocked) } });

  // Fetches one URL, following redirects by hand so that each new address is checked again.
  // Recursion keeps each hop readable: one call per request.
  async function follow(url: URL, redirectsLeft: number, signal: AbortSignal): Promise<FetchedPage> {
    checkUrl(url, settings);
    const res = await fetch(url, {
      dispatcher: agent,
      // Redirects come back to this function instead of being followed unchecked.
      redirect: 'manual',
      signal,
      headers: { accept: 'text/html', 'user-agent': 'BookmarkManagerPreview/1.0' },
    });
    if (REDIRECT_STATUSES.has(res.status)) {
      // The body of a redirect is not needed; cancelling frees the connection.
      await res.body?.cancel();
      const location = res.headers.get('location');
      if (location === null || redirectsLeft === 0) throw new UnreadablePageError('Too many redirects');
      // Location may be relative, so it is resolved against the current URL.
      return follow(new URL(location, url), redirectsLeft - 1, signal);
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new UnreadablePageError(`The page answered ${res.status}`);
    }
    // Only HTML has a title and meta tags to read.
    if (!(res.headers.get('content-type') ?? '').includes('text/html')) {
      await res.body?.cancel();
      throw new UnreadablePageError('That link is not a web page');
    }
    return { url: url.href, html: await readLimited(res.body, settings.maxBytes) };
  }

  return async (raw) => {
    // Unparseable text is refused like any other bad URL.
    const url = URL.canParse(raw) ? new URL(raw) : null;
    if (url === null) throw new RefusedUrlError('That is not a link');
    try {
      // One timer for the whole chain of requests.
      return await follow(url, settings.maxRedirects, AbortSignal.timeout(settings.timeoutMs));
    } catch (err) {
      // The guard's own refusals keep their meaning (400).
      if (isRefusal(err)) throw err instanceof RefusedUrlError ? err : new RefusedUrlError('That address is not allowed');
      // Known failures pass through as they are.
      if (err instanceof UnreadablePageError) throw err;
      // Anything else (timeout, unknown host, reset connection, bad redirect) is unreadable.
      throw new UnreadablePageError('The page could not be read');
    }
  };
}

// Builds the Express app without starting it. Tests import createApp() and hand the app to
// Supertest; index.ts imports the same function and calls listen.

// Express handles HTTP: routing and JSON parsing. The other two are only types.
import express, { type ErrorRequestHandler, type Express } from 'express';
// Sets the security headers (Content-Security-Policy and friends) on every answer.
import helmet from 'helmet';
// Joins folder and file names with the right separator for the system.
import { join } from 'node:path';
// The database client type.
import type { Db } from './db.ts';
// The error shape every failure is sent in, shared with the client.
import type { ApiError } from '../../shared/types.ts';
// The bad-input error, whose field issues go into the answer.
import { InputError } from './errors.ts';
// Every route under /api.
import { apiRouter } from './routes.ts';
// The SSRF-guarded page fetcher, and the type a test's fake must match.
import { type PageFetcher, createSafeFetch } from './safeFetch.ts';

// The largest JSON body accepted. A bookmark is a URL, a title, a description and a few
// tags, so 16 kB is plenty and stops anyone posting megabytes at the API.
const JSON_LIMIT = '16kb';

// HTTP status codes used here, by name.
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;
const HTTP_UNAVAILABLE = 503;

// Render puts proxies in front of the app; trusting this many hops lets req.ip be the
// visitor's address (from X-Forwarded-For) instead of the proxy's, for the rate limits.
const TRUSTED_PROXIES = 3;
// Default rate limits: new owners per IP per hour, and previews per owner per minute.
const OWNER_LIMIT = 10;
const PREVIEW_LIMIT = 30;

// Vite names every file in assets/ after a hash of its content, so a changed file gets a new
// name and an old name never changes meaning: browsers may keep these for a year.
const ASSET_MAX_AGE = '1y';

// The Content-Security-Policy, on top of helmet's defaults (scripts, styles and everything
// else only from this site). Card icons come from the bookmarked sites, so images may also
// load from any https host, or be inline data: URLs.
const CSP_DIRECTIVES = {
  imgSrc: ["'self'", 'data:', 'https:'],
};

// What the caller passes in. Only the database is required; tests swap the clock to fix the
// time, the fetcher to avoid the internet, and the limits to reach them quickly. clientDir is
// the built client (client/dist); without it the app serves the API alone, as in development,
// where Vite serves the client.
export interface AppOptions {
  db: Db;
  now?: () => Date;
  fetchPage?: PageFetcher;
  ownerLimit?: number;
  previewLimit?: number;
  clientDir?: string;
}

// The services with every default filled in. The routers receive this; clientDir is not a
// service, and has no default, so it stays out.
export type AppDeps = Required<Omit<AppOptions, 'clientDir'>>;

// Returns a new, fully wired app.
export function createApp(options: AppOptions): Express {
  // Fills in the defaults; anything the caller passed wins.
  const deps: AppDeps = {
    now: () => new Date(),
    ownerLimit: OWNER_LIMIT,
    previewLimit: PREVIEW_LIMIT,
    ...options,
    // Built only when the caller did not pass one.
    fetchPage: options.fetchPage ?? createSafeFetch(),
  };

  // Creates the app that every middleware and route below is attached to.
  const app = express();

  // Reads the visitor's address through the hosting proxies.
  app.set('trust proxy', TRUSTED_PROXIES);

  // Security headers first, so every answer below carries them, API and pages alike.
  app.use(helmet({ contentSecurityPolicy: { directives: CSP_DIRECTIVES } }));

  // Parses JSON request bodies into req.body, refusing anything over the limit with a 413.
  app.use(express.json({ limit: JSON_LIMIT }));

  // Asks the database a trivial question, so a health check shows the app can reach it.
  app.get('/api/health', async (_req, res) => {
    try {
      // SELECT 1 needs no table; it only proves the connection works.
      await deps.db.$queryRaw`SELECT 1`;
      res.json({ ok: true });
    } catch (err) {
      // Logged for debugging; the visitor only learns that the database is not answering.
      console.error(err);
      res.status(HTTP_UNAVAILABLE).json({ ok: false });
    }
  });

  // Owners, bookmarks, tags and previews.
  app.use('/api', apiRouter(deps));

  // Unknown API routes get JSON, not Express's HTML page. It runs only when no route
  // above matched, because a matching route ends the request.
  app.use('/api', (req, res) => {
    const body: ApiError = { error: `No route for ${req.method} ${req.originalUrl}` };
    res.status(HTTP_NOT_FOUND).json(body);
  });

  // The built client, after the API so /api never reaches it.
  if (options.clientDir) serveClient(app, options.clientDir);

  // Errors always come back as JSON. Bad JSON bodies arrive here with status 400, and
  // bodies over the limit with 413. Express knows this is the error handler because it
  // takes four arguments; `_next` is unused but must be listed.
  const handleError: ErrorRequestHandler = (err, _req, res, _next) => {
    // Use the error's own status when it has one, otherwise 500.
    const status: number = err.status ?? err.statusCode ?? HTTP_SERVER_ERROR;
    // Server faults are logged for debugging; client mistakes (4xx) are not.
    if (status >= HTTP_SERVER_ERROR) console.error(err);
    // A 500 never shows its internal message to the visitor; a 4xx explains what was wrong.
    const body: ApiError = { error: status >= HTTP_SERVER_ERROR ? 'Something went wrong' : err.message };
    // Bad input also lists what was wrong with each field.
    if (err instanceof InputError) body.issues = err.issues;
    res.status(status).json(body);
  };
  // Added last, so it catches errors from everything above.
  app.use(handleError);

  // The caller decides whether to listen (index.ts) or to test it (Supertest).
  return app;
}

// Serves the single-page client from dir: hashed assets, then the other files, then
// index.html for every other page address, so a reload of /?tags=react still finds the app.
function serveClient(app: Express, dir: string): void {
  // Hashed files, cached for a year. A missing one is a plain 404 (fallthrough: false), not
  // the page, so a stale script reference fails loudly instead of loading HTML as JavaScript.
  app.use(
    '/assets',
    express.static(join(dir, 'assets'), { immutable: true, maxAge: ASSET_MAX_AGE, fallthrough: false }),
  );
  // Unhashed files such as favicon.svg, revalidated each time. index: false leaves / to the
  // fallback below, so index.html always goes out with the same no-cache header.
  app.use(express.static(dir, { index: false }));
  // Every other GET is a page of the app: send index.html, and tell the browser to check
  // for a new one each time, so a deploy shows at once. cacheControl: false stops sendFile
  // from writing its own Cache-Control over ours.
  app.get('/{*page}', (_req, res) => {
    res.sendFile('index.html', { root: dir, cacheControl: false, headers: { 'Cache-Control': 'no-cache' } });
  });
}

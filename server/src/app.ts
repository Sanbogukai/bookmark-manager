// Builds the Express app without starting it. Tests import createApp() and hand the app to
// Supertest; index.ts imports the same function and calls listen.

// Express handles HTTP: routing and JSON parsing. The other two are only types.
import express, { type ErrorRequestHandler, type Express } from 'express';
// The database client type.
import type { Db } from './db.ts';
// The error shape every failure is sent in, shared with the client.
import type { ApiError } from '../../shared/types.ts';

// The largest JSON body accepted. A bookmark is a URL, a title, a description and a few
// tags, so 16 kB is plenty and stops anyone posting megabytes at the API.
const JSON_LIMIT = '16kb';

// HTTP status codes used here, by name.
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;
const HTTP_UNAVAILABLE = 503;

// What the caller passes in. Only the database is required; the clock exists so a test can
// fix the time.
export interface AppOptions {
  db: Db;
  now?: () => Date;
}

// The same services with every default filled in. The routers receive this.
export type AppDeps = Required<AppOptions>;

// Returns a new, fully wired app.
export function createApp(options: AppOptions): Express {
  // Fills in the defaults; anything the caller passed wins.
  const deps: AppDeps = { now: () => new Date(), ...options };

  // Creates the app that every middleware and route below is attached to.
  const app = express();

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

  // Unknown API routes get JSON, not Express's HTML page. It runs only when no route
  // above matched, because a matching route ends the request.
  app.use('/api', (req, res) => {
    const body: ApiError = { error: `No route for ${req.method} ${req.originalUrl}` };
    res.status(HTTP_NOT_FOUND).json(body);
  });

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
    res.status(status).json(body);
  };
  // Added last, so it catches errors from everything above.
  app.use(handleError);

  // The caller decides whether to listen (index.ts) or to test it (Supertest).
  return app;
}

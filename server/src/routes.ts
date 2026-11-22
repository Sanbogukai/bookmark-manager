// The API's routes: owners, bookmarks, tags and the link preview. Each route checks its input
// with Zod, finds the owner from the key header, and hands the work to bookmarks.ts or
// owners.ts.

// Router groups the routes; the rest are types for the handlers below.
import { Router, type Request, type RequestHandler, type Response } from 'express';
// Counts requests per visitor and answers 429 past the limit.
import { rateLimit } from 'express-rate-limit';
// Declares the shape of each input and reports every problem at once.
import { z } from 'zod';
// The services the routes use, with defaults filled in.
import type { AppDeps } from './app.ts';
// The bookmark and tag queries.
import {
  CURSOR_PATTERN,
  createBookmark,
  decodeCursor,
  deleteBookmark,
  listBookmarks,
  listTags,
  normalizeUrl,
  updateBookmark,
} from './bookmarks.ts';
// The error a route throws for bad input.
import { InputError } from './errors.ts';
// Owner creation and lookup.
import { HOUR_MS, createOwner, findOwnerId } from './owners.ts';
// Reads a title, description and icon out of a page's HTML.
import { DESCRIPTION_MAX, TITLE_MAX, readPreview } from './preview.ts';
// The guard's two kinds of failure.
import { RefusedUrlError, UnreadablePageError } from './safeFetch.ts';
// The shapes sent back.
import type { ApiError, DuplicateError, NewOwner } from '../../shared/types.ts';

// The header the browser sends its key in.
export const OWNER_HEADER = 'X-Owner-Key';

// HTTP status codes used here, by name.
const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_UNPROCESSABLE = 422;
const HTTP_TOO_MANY = 429;

// One minute, for the preview limit's window.
const MINUTE_MS = 60_000;

// Input limits. Browsers handle longer URLs, but 2048 covers any real page and keeps rows small.
const URL_MAX = 2048;
const TAGS_MAX = 10;
const SEARCH_MAX = 200;
// The largest id Postgres's INTEGER column holds; anything bigger cannot be a bookmark.
const ID_MAX = 2_147_483_647;

// http or https, the only schemes a reading list needs.
// Example: "https" and "http" match; "ftp" and "javascript" do not.
// Try it: https://regex101.com/?regex=%5Ehttps%3F%24&flavor=javascript&testString=https
const WEB_SCHEME = /^https?$/;

// A tag: 1 to 30 lower-case letters, digits or dashes.
// Example: "web-dev" and "postgres18" match; "Web Dev", "c++" and "" do not.
// Try it: https://regex101.com/?regex=%5E%5Ba-z0-9-%5D%7B1%2C30%7D%24&flavor=javascript&testString=web-dev
const TAG_PATTERN = /^[a-z0-9-]{1,30}$/;

// A web link, trimmed, at most URL_MAX characters.
const webUrl = z.string().trim().max(URL_MAX, 'Links can be at most 2048 characters').pipe(
  z.url({ protocol: WEB_SCHEME, message: 'Enter a web link starting with http:// or https://' }),
);

// A tag name, trimmed and lower-cased first so "Postgres " and "postgres" are the same tag.
const tagName = z
  .string()
  .trim()
  .toLowerCase()
  .regex(TAG_PATTERN, 'Tags use 1 to 30 letters, digits or dashes');

// A tag list without repeats; a Set keeps the first of each.
const tagList = z
  .array(tagName)
  .max(TAGS_MAX, 'Up to 10 tags')
  .transform((names) => [...new Set(names)]);

// A title: trimmed, not empty.
const title = z.string().trim().min(1, 'Enter a title').max(TITLE_MAX, 'Titles can be at most 300 characters');

// A description: trimmed, and an empty one is stored as none.
const description = z
  .string()
  .trim()
  .max(DESCRIPTION_MAX, 'Descriptions can be at most 1000 characters')
  .transform((text) => text || null)
  .nullish();

// POST /bookmarks.
const createBody = z.object({
  url: webUrl,
  title,
  description,
  iconUrl: webUrl.nullish(),
  tags: tagList.default([]),
});

// PATCH /bookmarks/:id: any of these, but at least one.
const patchBody = z
  .object({ title: title.optional(), description, tags: tagList.optional(), read: z.boolean().optional() })
  .refine((changes) => Object.values(changes).some((value) => value !== undefined), 'Nothing to change');

// GET /bookmarks. `tag` arrives as text once or as a list when repeated, so both become a list.
const listQuery = z.object({
  tag: z.preprocess((value) => (value === undefined ? [] : [value].flat()), tagList),
  status: z.enum(['all', 'unread', 'read']).default('all'),
  q: z.string().trim().max(SEARCH_MAX, 'Search text can be at most 200 characters').optional(),
  cursor: z.string().regex(CURSOR_PATTERN, 'Not a page marker').optional(),
});

// POST /preview.
const previewBody = z.object({ url: webUrl });

// A bookmark id from the path.
const idParam = z.coerce.number().int().positive().max(ID_MAX);

// The owner key: a UUID, as createOwner makes.
const ownerKey = z.uuid();

// The value if it fits the schema; otherwise an InputError listing every problem by field.
function check<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  // A problem with the whole object (such as "Nothing to change") has an empty path.
  throw new InputError(result.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })));
}

// Sends a JSON error with the given status.
function sendError(res: Response, status: number, body: ApiError): void {
  res.status(status).json(body);
}

// The 404 for a bookmark that is not this owner's. A missing one and another owner's look the
// same, so ids reveal nothing.
function notFound(res: Response): void {
  sendError(res, HTTP_NOT_FOUND, { error: 'No such bookmark' });
}

// The owner behind each request, recorded by requireOwner. A WeakMap keyed by the request
// drops the entry once the request is finished with, and keeps the request object untouched.
const owners = new WeakMap<Request, number>();

// The owner's id for a request that passed requireOwner.
function ownerOf(req: Request): number {
  // requireOwner runs first on every route that calls this, so the entry is always there.
  return owners.get(req) ?? 0;
}

// Builds the router over the app's services.
export function apiRouter(deps: AppDeps): Router {
  const router = Router();

  // Finds the owner from the key header, or answers 401. It is added to each route that
  // needs it rather than to the whole router, so an unknown /api path still gets a 404.
  const requireOwner: RequestHandler = async (req, res, next) => {
    // A key that is not even a UUID cannot exist, so it skips the database.
    const key = ownerKey.safeParse(req.get(OWNER_HEADER));
    const ownerId = key.success ? await findOwnerId(deps.db, key.data, deps.now()) : null;
    if (ownerId === null) {
      sendError(res, HTTP_UNAUTHORIZED, { error: 'Unknown or missing owner key' });
      return;
    }
    // Later handlers read it with ownerOf().
    owners.set(req, ownerId);
    next();
  };

  // The limit's 429 answer, in the API's error shape.
  const tooMany: RequestHandler = (_req, res) => {
    sendError(res, HTTP_TOO_MANY, { error: 'Too many requests; try again later' });
  };

  // New owners per IP address per hour. Each owner copies the samples, so this keeps a script
  // from filling the database. The store is in memory: one per app, reset on restart.
  const ownerLimiter = rateLimit({
    windowMs: HOUR_MS,
    limit: deps.ownerLimit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: tooMany,
  });

  // Previews per owner per minute. Counted by owner, not IP, so a shared network does not
  // share one allowance.
  const previewLimiter = rateLimit({
    windowMs: MINUTE_MS,
    limit: deps.previewLimit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => `owner-${ownerOf(req)}`,
    handler: tooMany,
  });

  // Makes an owner with the sample bookmarks and returns its key.
  router.post('/owners', ownerLimiter, async (_req, res) => {
    const body: NewOwner = { key: await createOwner(deps.db, deps.now()) };
    res.status(HTTP_CREATED).json(body);
  });

  // One page of bookmarks, filtered.
  router.get('/bookmarks', requireOwner, async (req, res) => {
    const query = check(listQuery, req.query);
    const page = await listBookmarks(deps.db, ownerOf(req), {
      tags: query.tag,
      status: query.status,
      q: query.q,
      cursor: query.cursor === undefined ? undefined : decodeCursor(query.cursor),
    });
    res.json(page);
  });

  // Saves a link, or answers 409 with the bookmark already saved under it.
  router.post('/bookmarks', requireOwner, async (req, res) => {
    const input = check(createBody, req.body);
    // Normalised before saving, so the duplicate check compares like with like.
    const result = await createBookmark(deps.db, ownerOf(req), { ...input, url: normalizeUrl(input.url) }, deps.now());
    if ('existing' in result) {
      const body: DuplicateError = { error: 'Already saved', existing: result.existing };
      res.status(HTTP_CONFLICT).json(body);
      return;
    }
    res.status(HTTP_CREATED).json(result.created);
  });

  // Changes a bookmark's title, description, tags or read state.
  router.patch('/bookmarks/:id', requireOwner, async (req, res) => {
    // A path that is not a valid id cannot name a bookmark, so it is a 404 like a missing one.
    const id = idParam.safeParse(req.params.id);
    if (!id.success) {
      notFound(res);
      return;
    }
    const changes = check(patchBody, req.body);
    const updated = await updateBookmark(deps.db, ownerOf(req), id.data, changes, deps.now());
    if (updated === null) {
      notFound(res);
      return;
    }
    res.json(updated);
  });

  // Deletes a bookmark.
  router.delete('/bookmarks/:id', requireOwner, async (req, res) => {
    const id = idParam.safeParse(req.params.id);
    const deleted = id.success && (await deleteBookmark(deps.db, ownerOf(req), id.data));
    if (!deleted) {
      notFound(res);
      return;
    }
    res.status(HTTP_NO_CONTENT).end();
  });

  // The owner's tags with counts.
  router.get('/tags', requireOwner, async (req, res) => {
    res.json(await listTags(deps.db, ownerOf(req)));
  });

  // Reads a page's title, description and icon for the add form.
  router.post('/preview', requireOwner, previewLimiter, async (req, res) => {
    const { url } = check(previewBody, req.body);
    try {
      const page = await deps.fetchPage(url);
      // `page.url` is where it ended up after redirects, for resolving relative icon links.
      res.json(readPreview(page.html, page.url));
    } catch (err) {
      // A refused address is the request's fault, reported against the url field.
      if (err instanceof RefusedUrlError) throw new InputError([{ field: 'url', message: err.message }]);
      // A page that could not be read: the form stays usable, the visitor types the title.
      if (err instanceof UnreadablePageError) {
        sendError(res, HTTP_UNPROCESSABLE, { error: err.message });
        return;
      }
      throw err;
    }
  });

  return router;
}

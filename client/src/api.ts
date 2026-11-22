// Thin, typed wrappers over the API. This is the only file that talks to the server;
// components call these functions instead. Every failure becomes an ApiError whose message
// is safe to show, with the server's per-field issues attached when there are any.

// The shapes the server sends and accepts. `import type` is erased before the code runs.
import type {
  Bookmark,
  BookmarkPage,
  CreateBookmark,
  ApiError as ErrorBody,
  Issue,
  Preview,
  TagCount,
  UpdateBookmark,
} from '../../shared/types.ts'
// Adds the owner key to each request.
import { createKeyedFetch } from './keyedFetch.ts'
// The filters, turned into the list's query string.
import { type Filters, toListQuery } from './filters.ts'

// Statuses from 500 up are the server's fault, not the request's.
const HTTP_SERVER_ERROR = 500
// 204 has no body to read.
const HTTP_NO_CONTENT = 204

// An Error that also carries the HTTP status, any field issues, and for a 409 the bookmark
// already saved under that link.
export class ApiError extends Error {
  // The response status.
  status: number
  // Empty unless the server named the fields at fault.
  issues: Issue[]
  // Set on a 409 "Already saved".
  existing: Bookmark | null

  constructor(message: string, status: number, issues: Issue[] = [], existing: Bookmark | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.issues = issues
    this.existing = existing
  }
}

// One sender for the whole app, over the real localStorage and fetch.
const keyed = createKeyedFetch(window.localStorage, (url, init) => fetch(url, init))

// Sends one request and returns the parsed JSON body as type T. The caller names T;
// TypeScript trusts the server sends that shape, which holds because both sides share
// shared/types.ts.
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await keyed.send(path, {
    // Only requests with a body say they are sending JSON.
    headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  })
  // Nothing to read on 204 No Content.
  if (res.status === HTTP_NO_CONTENT) return undefined as T
  // A body that is not JSON (a proxy's error page) becomes null instead of a crash.
  const body: unknown = await res.json().catch(() => null)
  if (res.ok) return body as T
  // Partial, because a proxy or crash page might send something else entirely.
  const problem = (body ?? {}) as Partial<ErrorBody> & { existing?: Bookmark }
  // A 5xx with no message usually means the API server is down (Vite's proxy answers 502).
  const fallback = res.status >= HTTP_SERVER_ERROR ? 'The server is not responding' : 'Request failed'
  throw new ApiError(problem.error ?? `${fallback} (${res.status})`, res.status, problem.issues ?? [], problem.existing ?? null)
}

// A JSON request body.
function jsonBody(method: string, data: unknown): RequestInit {
  return { method, body: JSON.stringify(data) }
}

// One page of bookmarks for the filters, starting after `cursor` when given.
export function listBookmarks(filters: Filters, cursor: string | null, signal?: AbortSignal): Promise<BookmarkPage> {
  return request(`/bookmarks?${toListQuery(filters, cursor)}`, { signal })
}

// The owner's tags with counts.
export function listTags(signal?: AbortSignal): Promise<TagCount[]> {
  return request('/tags', { signal })
}

// Saves a new bookmark. A 409 throws an ApiError carrying the existing one.
export function createBookmark(input: CreateBookmark): Promise<Bookmark> {
  return request('/bookmarks', jsonBody('POST', input))
}

// Changes a bookmark.
export function updateBookmark(id: number, changes: UpdateBookmark): Promise<Bookmark> {
  return request(`/bookmarks/${id}`, jsonBody('PATCH', changes))
}

// Deletes a bookmark.
export function deleteBookmark(id: number): Promise<void> {
  return request(`/bookmarks/${id}`, { method: 'DELETE' })
}

// The title, description and icon read from a page.
export function fetchPreview(url: string): Promise<Preview> {
  return request('/preview', jsonBody('POST', { url }))
}

// Starts a fresh list with the samples; the old one is left for the server's clean-up.
export async function startOver(): Promise<void> {
  await keyed.startOver()
}

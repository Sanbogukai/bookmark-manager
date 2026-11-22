// Shared set-up for the API tests: one connection to the test database, emptied before each
// test, and a fresh app over it with a fixed clock.

// Supertest sends HTTP requests straight to an Express app, without opening a port.
import request from 'supertest';
// The app under test, and the options a test may override.
import { type AppOptions, createApp } from '../src/app.ts';
// Makes the Prisma client.
import { type Db, createDb } from '../src/db.ts';
// The guarded test database address.
import { testDatabaseUrl } from './testDatabase.ts';
// Makes owners straight in the database, skipping the rate-limited route.
import { createOwner } from '../src/owners.ts';
// The header the key travels in.
import { OWNER_HEADER } from '../src/routes.ts';
// The sample type, for tests that pass their own.
import type { Sample } from '../src/samples.ts';
// The fetcher type a fake must match.
import type { PageFetcher } from '../src/safeFetch.ts';

// The HTTP status codes the tests expect, by name, so each check says what it means.
export const OK = 200;
export const CREATED = 201;
export const NO_CONTENT = 204;
export const BAD_REQUEST = 400;
export const UNAUTHORIZED = 401;
export const NOT_FOUND = 404;
export const CONFLICT = 409;
export const UNPROCESSABLE = 422;
export const TOO_MANY = 429;

// The key header's name, re-exported so tests set it the same way the app reads it.
export const KEY = OWNER_HEADER;

// A fetcher that never touches the network: it answers every URL with this HTML, as if the
// page were at that URL. Route tests pass it in place of the real one.
export function fakeFetcher(html: string): PageFetcher {
  return async (url) => ({ url, html });
}

// The moment every test runs at, unless it says otherwise: noon UTC on 22 November 2026.
export const NOW = new Date('2026-11-22T12:00:00Z');

// One client per test file; opening a pool per test would be slow and use up connections.
export const db: Db = createDb(testDatabaseUrl());

// Empties every table and restarts the id counters, so each test sees ids from 1.
// CASCADE also clears the rows that point at the emptied tables.
export async function resetDb(): Promise<void> {
  await db.$executeRawUnsafe(
    'TRUNCATE "Owner", "Bookmark", "Tag", "BookmarkTag" RESTART IDENTITY CASCADE',
  );
}

// Makes an owner and returns its key. No samples by default, so a test starts from nothing.
export function newOwner(samples: Sample[] = []): Promise<string> {
  return createOwner(db, NOW, samples);
}

// A clock that moves one second forward each time it is read, so bookmarks saved one after
// another get different, increasing times. The count lives in an array so it can change
// without reassigning a variable.
export function tickingClock(start: Date = NOW): () => Date {
  const SECOND_MS = 1000;
  const reads = [0];
  return () => {
    const tick = reads.length;
    reads.push(tick);
    return new Date(start.getTime() + tick * SECOND_MS);
  };
}

// Builds a fresh app over the shared test database. `overrides` can swap the clock.
export function makeApp(overrides: Partial<AppOptions> = {}) {
  // The fixed clock and an empty fake page first, so a test's own overrides still win and no
  // test reaches the internet by accident.
  const app = createApp({ db, now: () => NOW, fetchPage: fakeFetcher(''), ...overrides });
  // `api` is a Supertest agent bound to this app.
  return { api: request(app), app };
}

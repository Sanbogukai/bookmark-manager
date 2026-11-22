// Bookmarks: saving, duplicates, input checks, filters, paging, edits and deletes.

// Vitest's test functions.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
// Supertest's agent type, for the small helpers below.
import type { Agent } from 'supertest';
// Shared set-up.
import {
  BAD_REQUEST,
  CONFLICT,
  CREATED,
  KEY,
  NOT_FOUND,
  NO_CONTENT,
  OK,
  db,
  makeApp,
  newOwner,
  resetDb,
  tickingClock,
} from './helpers.ts';
// The page size, to fill more than one page.
import { PAGE_SIZE } from '../src/bookmarks.ts';
// The API's shapes.
import type { Bookmark, CreateBookmark } from '../../shared/types.ts';

// Each test starts from empty tables; the connection closes when the file is done.
beforeEach(resetDb);
afterAll(() => db.$disconnect());

// A test app with a ticking clock (so saves have distinct times), and a fresh owner's key.
async function setUp() {
  const { api } = makeApp({ now: tickingClock() });
  return { api: api as unknown as Agent, key: await newOwner() };
}

// Saves a bookmark through the API and returns the answer.
function save(api: Agent, key: string, body: Partial<CreateBookmark>) {
  return api.post('/api/bookmarks').set(KEY, key).send(body);
}

// The URLs of a list answer, in order.
function urlsOf(items: Bookmark[]): string[] {
  return items.map((item) => item.url);
}

describe('POST /api/bookmarks', () => {
  it('saves a bookmark with tags, trimmed, lower-cased and without repeats', async () => {
    const { api, key } = await setUp();
    const res = await save(api, key, {
      url: 'https://example.com/a',
      title: '  An article  ',
      description: 'About things',
      tags: ['Reading', 'reading ', 'web-dev'],
    });
    expect(res.status).toBe(CREATED);
    expect(res.body).toMatchObject({
      url: 'https://example.com/a',
      title: 'An article',
      description: 'About things',
      iconUrl: null,
      tags: ['reading', 'web-dev'],
      readAt: null,
    });
  });

  it('normalises the URL so the same page is caught as a duplicate', async () => {
    const { api, key } = await setUp();
    const first = await save(api, key, { url: 'HTTPS://Example.COM:443#top', title: 'Home' });
    // Scheme and host lower-cased, default port and fragment dropped, root slash added.
    expect(first.body.url).toBe('https://example.com/');
    const again = await save(api, key, { url: 'https://example.com/', title: 'Home again' });
    expect(again.status).toBe(CONFLICT);
    expect(again.body.existing.id).toBe(first.body.id);
  });

  it('keeps the query string, which picks the content', async () => {
    const { api, key } = await setUp();
    await save(api, key, { url: 'https://example.com/?page=1', title: 'One' });
    expect((await save(api, key, { url: 'https://example.com/?page=2', title: 'Two' })).status).toBe(CREATED);
  });

  it('lets two owners save the same URL', async () => {
    const { api, key } = await setUp();
    const other = await newOwner();
    await save(api, key, { url: 'https://example.com/', title: 'Mine' });
    expect((await save(api, other, { url: 'https://example.com/', title: 'Theirs' })).status).toBe(CREATED);
  });

  it('answers 400 with one issue per bad field', async () => {
    const { api, key } = await setUp();
    const res = await save(api, key, { url: 'ftp://example.com/', title: '   ', tags: ['no spaces'] });
    expect(res.status).toBe(BAD_REQUEST);
    const fields = res.body.issues.map((issue: { field: string }) => issue.field);
    expect(fields).toEqual(expect.arrayContaining(['url', 'title', 'tags.0']));
  });

  it('refuses a URL over 2048 characters and more than 10 tags', async () => {
    const { api, key } = await setUp();
    const URL_MAX = 2048;
    const TAGS_MAX = 10;
    const longUrl = `https://example.com/${'a'.repeat(URL_MAX)}`;
    const tags = Array.from({ length: TAGS_MAX + 1 }, (_, index) => `t${index}`);
    const res = await save(api, key, { url: longUrl, title: 'Long', tags });
    expect(res.status).toBe(BAD_REQUEST);
    expect(res.body.issues.map((issue: { field: string }) => issue.field)).toEqual(['url', 'tags']);
  });
});

describe('GET /api/bookmarks', () => {
  // Saves the given bookmarks in order, so the last is the newest.
  async function saveAll(api: Agent, key: string, bodies: Partial<CreateBookmark>[]) {
    // One after another, so the ticking clock gives each a later time than the one before.
    await bodies.reduce(async (previous, body) => {
      await previous;
      await save(api, key, body);
    }, Promise.resolve());
  }

  it('filters by read state, every given tag, and search text', async () => {
    const { api, key } = await setUp();
    await saveAll(api, key, [
      { url: 'https://a.example/', title: 'Alpha', tags: ['x', 'y'] },
      { url: 'https://b.example/', title: 'Beta', tags: ['x'] },
      { url: 'https://c.example/gamma', title: 'Third', tags: ['y'] },
    ]);
    // Marks Beta read.
    const list = await api.get('/api/bookmarks').set(KEY, key);
    const beta = list.body.items.find((item: Bookmark) => item.title === 'Beta');
    await api.patch(`/api/bookmarks/${beta.id}`).set(KEY, key).send({ read: true });

    // Each query and the URLs it should return, newest first.
    const cases: [string, string[]][] = [
      ['', ['https://c.example/gamma', 'https://b.example/', 'https://a.example/']],
      ['?status=read', ['https://b.example/']],
      ['?status=unread', ['https://c.example/gamma', 'https://a.example/']],
      ['?tag=x', ['https://b.example/', 'https://a.example/']],
      // Two tags mean both.
      ['?tag=x&tag=y', ['https://a.example/']],
      // Search covers the title, ignoring case…
      ['?q=ALPHA', ['https://a.example/']],
      // …and the URL.
      ['?q=gamma', ['https://c.example/gamma']],
    ];
    const answers = await Promise.all(cases.map(([query]) => api.get(`/api/bookmarks${query}`).set(KEY, key)));
    expect(answers.map((res) => urlsOf(res.body.items))).toEqual(cases.map(([, urls]) => urls));
  });

  it('treats % and _ in search text as plain characters', async () => {
    const { api, key } = await setUp();
    await saveAll(api, key, [
      { url: 'https://a.example/', title: '100% done' },
      { url: 'https://b.example/', title: '1000 things' },
      { url: 'https://c.example/', title: 'snake_case' },
      { url: 'https://d.example/', title: 'snakeXcase' },
    ]);
    const percent = await api.get('/api/bookmarks').query({ q: '0%' }).set(KEY, key);
    expect(urlsOf(percent.body.items)).toEqual(['https://a.example/']);
    const underscore = await api.get('/api/bookmarks').query({ q: 'e_c' }).set(KEY, key);
    expect(urlsOf(underscore.body.items)).toEqual(['https://c.example/']);
  });

  it('pages through every bookmark once, even after the cursor row is deleted', async () => {
    const { api, key } = await setUp();
    // A full page and a bit, so there are two pages even after one row is deleted.
    const SECOND_PAGE_ROWS = 2;
    const total = PAGE_SIZE + SECOND_PAGE_ROWS;
    await saveAll(
      api,
      key,
      Array.from({ length: total }, (_, index) => ({ url: `https://example.com/${index}`, title: `Item ${index}` })),
    );
    const first = await api.get('/api/bookmarks').set(KEY, key);
    expect(first.body.items).toHaveLength(PAGE_SIZE);
    expect(first.body.nextCursor).toEqual(expect.any(String));

    // Deleting the row the cursor points at must not break the next page.
    const lastShown = first.body.items.at(-1);
    await api.delete(`/api/bookmarks/${lastShown.id}`).set(KEY, key);

    const second = await api.get('/api/bookmarks').query({ cursor: first.body.nextCursor }).set(KEY, key);
    expect(second.body.nextCursor).toBeNull();
    const seen = [...urlsOf(first.body.items), ...urlsOf(second.body.items)];
    // Every bookmark once, no repeats.
    expect(new Set(seen).size).toBe(total);
    expect(seen).toHaveLength(total);
  });

  it('refuses a malformed cursor and status', async () => {
    const { api, key } = await setUp();
    const res = await api.get('/api/bookmarks').query({ cursor: 'abc', status: 'maybe' }).set(KEY, key);
    expect(res.status).toBe(BAD_REQUEST);
    expect(res.body.issues.map((issue: { field: string }) => issue.field).toSorted()).toEqual(['cursor', 'status']);
  });
});

describe('PATCH /api/bookmarks/:id', () => {
  it('marks read and unread, keeping the first read time', async () => {
    const { api, key } = await setUp();
    const { body: saved } = await save(api, key, { url: 'https://example.com/', title: 'Page' });
    const read = await api.patch(`/api/bookmarks/${saved.id}`).set(KEY, key).send({ read: true });
    expect(read.status).toBe(OK);
    expect(read.body.readAt).toEqual(expect.any(String));
    // Marking read again keeps the original time.
    const again = await api.patch(`/api/bookmarks/${saved.id}`).set(KEY, key).send({ read: true });
    expect(again.body.readAt).toBe(read.body.readAt);
    const unread = await api.patch(`/api/bookmarks/${saved.id}`).set(KEY, key).send({ read: false });
    expect(unread.body.readAt).toBeNull();
  });

  it('changes the title, clears the description and replaces the tags', async () => {
    const { api, key } = await setUp();
    const { body: saved } = await save(api, key, {
      url: 'https://example.com/',
      title: 'Old',
      description: 'Old words',
      tags: ['a', 'b'],
    });
    const res = await api
      .patch(`/api/bookmarks/${saved.id}`)
      .set(KEY, key)
      .send({ title: 'New', description: null, tags: ['b', 'c'] });
    expect(res.body).toMatchObject({ title: 'New', description: null, tags: ['b', 'c'] });
  });

  it('answers 400 for an empty change and 404 for a bad or missing id', async () => {
    const { api, key } = await setUp();
    const { body: saved } = await save(api, key, { url: 'https://example.com/', title: 'Page' });
    const empty = await api.patch(`/api/bookmarks/${saved.id}`).set(KEY, key).send({});
    expect(empty.status).toBe(BAD_REQUEST);
    expect(empty.body.issues[0].message).toBe('Nothing to change');
    expect((await api.patch('/api/bookmarks/abc').set(KEY, key).send({ read: true })).status).toBe(NOT_FOUND);
    expect((await api.patch('/api/bookmarks/99999').set(KEY, key).send({ read: true })).status).toBe(NOT_FOUND);
  });
});

describe('DELETE /api/bookmarks/:id', () => {
  it('deletes once, then answers 404', async () => {
    const { api, key } = await setUp();
    const { body: saved } = await save(api, key, { url: 'https://example.com/', title: 'Page' });
    expect((await api.delete(`/api/bookmarks/${saved.id}`).set(KEY, key)).status).toBe(NO_CONTENT);
    expect((await api.delete(`/api/bookmarks/${saved.id}`).set(KEY, key)).status).toBe(NOT_FOUND);
    expect(await db.bookmark.count()).toBe(0);
  });
});

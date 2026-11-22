// The link preview: reading a page's details, and the route around it with a fake fetcher.

// Vitest's test functions.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
// Shared set-up.
import {
  BAD_REQUEST,
  KEY,
  OK,
  TOO_MANY,
  UNAUTHORIZED,
  UNPROCESSABLE,
  db,
  fakeFetcher,
  makeApp,
  newOwner,
  resetDb,
} from './helpers.ts';
// The code under test.
import { DESCRIPTION_MAX, TITLE_MAX, readPreview } from '../src/preview.ts';
// The two failures a fetcher can raise.
import { type PageFetcher, RefusedUrlError, UnreadablePageError } from '../src/safeFetch.ts';

// Each test starts from empty tables; the connection closes when the file is done.
beforeEach(resetDb);
afterAll(() => db.$disconnect());

// Where every test page claims to be.
const PAGE = 'https://example.com/articles/one';

describe('readPreview', () => {
  it('prefers the og: tags and resolves a relative icon', () => {
    const html = `<html><head>
      <title>One | Example</title>
      <meta property="og:title" content="One">
      <meta property="og:description" content="The first article.">
      <meta name="description" content="Plain description">
      <link rel="shortcut icon" href="/static/icon.png">
    </head></html>`;
    expect(readPreview(html, PAGE)).toEqual({
      title: 'One',
      description: 'The first article.',
      iconUrl: 'https://example.com/static/icon.png',
    });
  });

  it('falls back to <title>, the description tag and /favicon.ico', () => {
    const html = '<title>\n  Plain   page \n</title><meta name="description" content="Words">';
    expect(readPreview(html, PAGE)).toEqual({
      title: 'Plain page',
      description: 'Words',
      iconUrl: 'https://example.com/favicon.ico',
    });
  });

  it('gives nulls for a page with nothing to read, and drops a non-web icon', () => {
    const html = '<link rel="icon" href="data:image/png;base64,AAAA">';
    expect(readPreview(html, PAGE)).toEqual({ title: null, description: null, iconUrl: null });
  });

  it('cuts a long title and description to the form limits', () => {
    const OVER = 50;
    const html = `<title>${'t'.repeat(TITLE_MAX + OVER)}</title>
      <meta name="description" content="${'d'.repeat(DESCRIPTION_MAX + OVER)}">`;
    const preview = readPreview(html, PAGE);
    expect(preview.title).toHaveLength(TITLE_MAX);
    expect(preview.description).toHaveLength(DESCRIPTION_MAX);
  });
});

describe('POST /api/preview', () => {
  // An app with the given fetcher, and an owner's key.
  async function setUp(fetchPage: PageFetcher, previewLimit?: number) {
    const { api } = makeApp({ fetchPage, ...(previewLimit === undefined ? {} : { previewLimit }) });
    return { api, key: await newOwner() };
  }

  // A fetcher that always fails with the given error.
  const failing = (error: Error): PageFetcher => async () => {
    throw error;
  };

  it("returns the page's details", async () => {
    const { api, key } = await setUp(fakeFetcher('<title>Hello</title>'));
    const res = await api.post('/api/preview').set(KEY, key).send({ url: PAGE });
    expect(res.status).toBe(OK);
    expect(res.body).toEqual({ title: 'Hello', description: null, iconUrl: 'https://example.com/favicon.ico' });
  });

  it('needs an owner', async () => {
    const { api } = await setUp(fakeFetcher(''));
    expect((await api.post('/api/preview').send({ url: PAGE })).status).toBe(UNAUTHORIZED);
  });

  it('answers 400 for a link that is not http(s)', async () => {
    const { api, key } = await setUp(fakeFetcher(''));
    const res = await api.post('/api/preview').set(KEY, key).send({ url: 'file:///etc/passwd' });
    expect(res.status).toBe(BAD_REQUEST);
    expect(res.body.issues[0].field).toBe('url');
  });

  it('answers 400 on the url field when the guard refuses the address', async () => {
    const { api, key } = await setUp(failing(new RefusedUrlError('That address is not allowed')));
    const res = await api.post('/api/preview').set(KEY, key).send({ url: 'http://127.0.0.1/' });
    expect(res.status).toBe(BAD_REQUEST);
    expect(res.body.issues).toEqual([{ field: 'url', message: 'That address is not allowed' }]);
  });

  it('answers 422 when the page cannot be read', async () => {
    const { api, key } = await setUp(failing(new UnreadablePageError('That link is not a web page')));
    const res = await api.post('/api/preview').set(KEY, key).send({ url: PAGE });
    expect(res.status).toBe(UNPROCESSABLE);
    expect(res.body.error).toBe('That link is not a web page');
  });

  it('answers 429 past the per-owner limit, counting each owner apart', async () => {
    const { api, key } = await setUp(fakeFetcher(''), 1);
    expect((await api.post('/api/preview').set(KEY, key).send({ url: PAGE })).status).toBe(OK);
    expect((await api.post('/api/preview').set(KEY, key).send({ url: PAGE })).status).toBe(TOO_MANY);
    // A second owner on the same address has its own allowance.
    const other = await newOwner();
    expect((await api.post('/api/preview').set(KEY, other).send({ url: PAGE })).status).toBe(OK);
  });
});

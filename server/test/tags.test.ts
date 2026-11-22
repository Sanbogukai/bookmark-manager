// Tags: counts per owner, and tags removed once no bookmark uses them.

// Vitest's test functions.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
// Shared set-up.
import { KEY, OK, db, makeApp, newOwner, resetDb } from './helpers.ts';
// The samples, to check a new owner's tag counts.
import { SAMPLES } from '../src/samples.ts';

// Each test starts from empty tables; the connection closes when the file is done.
beforeEach(resetDb);
afterAll(() => db.$disconnect());

describe('GET /api/tags', () => {
  it("lists the owner's tags in name order with how many bookmarks carry each", async () => {
    const { api } = makeApp();
    const key = await newOwner(SAMPLES);
    const res = await api.get('/api/tags').set(KEY, key);
    expect(res.status).toBe(OK);
    // The expected counts, worked out from the samples themselves.
    const names = [...new Set(SAMPLES.flatMap((sample) => sample.tags))].toSorted();
    const expected = names.map((name) => ({
      name,
      count: SAMPLES.filter((sample) => sample.tags.includes(name)).length,
    }));
    expect(res.body).toEqual(expected);
  });

  it("never shows another owner's tags", async () => {
    const { api } = makeApp();
    await newOwner(SAMPLES);
    const empty = await newOwner();
    expect((await api.get('/api/tags').set(KEY, empty)).body).toEqual([]);
  });
});

describe('unused tags', () => {
  // An owner with two bookmarks: one tagged a and b, one tagged b.
  async function setUp() {
    const { api } = makeApp();
    const key = await newOwner();
    const first = await api
      .post('/api/bookmarks')
      .set(KEY, key)
      .send({ url: 'https://one.example/', title: 'One', tags: ['a', 'b'] });
    await api.post('/api/bookmarks').set(KEY, key).send({ url: 'https://two.example/', title: 'Two', tags: ['b'] });
    // The tag names the owner has now.
    const tagNames = async () => (await api.get('/api/tags').set(KEY, key)).body.map((tag: { name: string }) => tag.name);
    return { api, key, id: first.body.id, tagNames };
  }

  it('go when an edit drops the last use', async () => {
    const { api, key, id, tagNames } = await setUp();
    await api.patch(`/api/bookmarks/${id}`).set(KEY, key).send({ tags: ['b', 'c'] });
    expect(await tagNames()).toEqual(['b', 'c']);
  });

  it('go when the last bookmark using them is deleted', async () => {
    const { api, key, id, tagNames } = await setUp();
    await api.delete(`/api/bookmarks/${id}`).set(KEY, key);
    expect(await tagNames()).toEqual(['b']);
  });

  it('stay while another bookmark still uses them', async () => {
    const { api, key, id, tagNames } = await setUp();
    await api.patch(`/api/bookmarks/${id}`).set(KEY, key).send({ tags: [] });
    expect(await tagNames()).toEqual(['b']);
  });
});

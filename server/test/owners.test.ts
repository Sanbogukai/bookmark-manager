// Owners: creation with samples, the key check, last-seen updates and the stale clean-up.

// Vitest's test functions.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
// Shared set-up.
import { CREATED, KEY, NOT_FOUND, NOW, OK, TOO_MANY, UNAUTHORIZED, db, makeApp, newOwner, resetDb } from './helpers.ts';
// The code under test, and its time constants.
import { DAY_MS, HOUR_MS, STALE_DAYS, deleteStaleOwners, findOwnerId } from '../src/owners.ts';
// The samples every new owner gets.
import { SAMPLES } from '../src/samples.ts';

// Each test starts from empty tables; the connection closes when the file is done.
beforeEach(resetDb);
afterAll(() => db.$disconnect());

// A moment `ms` milliseconds after NOW.
const later = (ms: number) => new Date(NOW.getTime() + ms);

describe('POST /api/owners', () => {
  it('returns a key whose owner holds a copy of every sample', async () => {
    const { api } = makeApp();
    const res = await api.post('/api/owners');
    expect(res.status).toBe(CREATED);
    // The key unlocks the list, which holds every sample.
    const list = await api.get('/api/bookmarks').set(KEY, res.body.key);
    expect(list.status).toBe(OK);
    expect(list.body.items).toHaveLength(SAMPLES.length);
    // Newest first: the last sample was saved most recently.
    expect(list.body.items[0].url).toBe(SAMPLES.at(-1)?.url);
    // The read ones are marked read.
    const readCount = list.body.items.filter((item: { readAt: string | null }) => item.readAt !== null).length;
    expect(readCount).toBe(SAMPLES.filter((sample) => sample.read).length);
  });

  it('gives each owner a separate copy', async () => {
    const { api } = makeApp();
    const first = await api.post('/api/owners');
    const second = await api.post('/api/owners');
    const firstList = await api.get('/api/bookmarks').set(KEY, first.body.key);
    // The first owner deletes a sample; the second still has it.
    const [victim] = firstList.body.items;
    await api.delete(`/api/bookmarks/${victim.id}`).set(KEY, first.body.key);
    const secondList = await api.get('/api/bookmarks').set(KEY, second.body.key);
    expect(secondList.body.items).toHaveLength(SAMPLES.length);
  });

  it('answers 429 past the hourly limit per address', async () => {
    const { api } = makeApp({ ownerLimit: 1 });
    expect((await api.post('/api/owners')).status).toBe(CREATED);
    const blocked = await api.post('/api/owners');
    expect(blocked.status).toBe(TOO_MANY);
    expect(blocked.body.error).toContain('Too many');
    // Another address still gets one; trust proxy reads it from X-Forwarded-For.
    const other = await api.post('/api/owners').set('X-Forwarded-For', '203.0.113.9');
    expect(other.status).toBe(CREATED);
  });
});

describe('the owner key', () => {
  it('is required', async () => {
    const { api } = makeApp();
    const res = await api.get('/api/bookmarks');
    expect(res.status).toBe(UNAUTHORIZED);
    expect(res.body.error).toBeTruthy();
  });

  it('must be a UUID', async () => {
    const { api } = makeApp();
    expect((await api.get('/api/tags').set(KEY, 'not-a-key')).status).toBe(UNAUTHORIZED);
  });

  it('must belong to an owner', async () => {
    const { api } = makeApp();
    const res = await api.get('/api/tags').set(KEY, crypto.randomUUID());
    expect(res.status).toBe(UNAUTHORIZED);
  });

  it("cannot reach another owner's bookmark", async () => {
    const { api } = makeApp();
    const owner = await newOwner(SAMPLES);
    const stranger = await newOwner();
    const [mine] = (await api.get('/api/bookmarks').set(KEY, owner)).body.items;
    // Both edit and delete look exactly like a missing bookmark.
    expect((await api.patch(`/api/bookmarks/${mine.id}`).set(KEY, stranger).send({ read: true })).status).toBe(
      NOT_FOUND,
    );
    expect((await api.delete(`/api/bookmarks/${mine.id}`).set(KEY, stranger)).status).toBe(NOT_FOUND);
    // The owner's copy is untouched.
    const after = await api.get('/api/bookmarks').set(KEY, owner);
    expect(after.body.items).toHaveLength(SAMPLES.length);
  });

  it('still lets unknown /api paths answer 404, not 401', async () => {
    const { api } = makeApp();
    expect((await api.get('/api/nothing-here')).status).toBe(NOT_FOUND);
  });
});

describe('last seen', () => {
  // The owner's stored last-seen time.
  async function lastSeen(key: string): Promise<number | undefined> {
    const owner = await db.owner.findUnique({ where: { key } });
    return owner?.lastSeenAt.getTime();
  }

  it('is written at most once an hour', async () => {
    const key = await newOwner();
    // Within the hour: unchanged.
    await findOwnerId(db, key, later(HOUR_MS));
    expect(await lastSeen(key)).toBe(NOW.getTime());
    // Past the hour: moved to the new time.
    const pastHour = later(HOUR_MS + 1);
    await findOwnerId(db, key, pastHour);
    expect(await lastSeen(key)).toBe(pastHour.getTime());
  });
});

describe('deleteStaleOwners', () => {
  it('removes owners unseen for 30 days, with their bookmarks and tags', async () => {
    const stale = await newOwner(SAMPLES);
    // Seen again just before the clean-up, so it stays.
    const fresh = await newOwner(SAMPLES);
    const cleanUpAt = later(STALE_DAYS * DAY_MS + 1);
    await findOwnerId(db, fresh, cleanUpAt);

    expect(await deleteStaleOwners(db, cleanUpAt)).toBe(1);
    // The stale owner's rows are gone; the fresh owner's remain.
    expect(await db.owner.findUnique({ where: { key: stale } })).toBeNull();
    expect(await db.bookmark.count()).toBe(SAMPLES.length);
    const freshOwner = await db.owner.findUnique({ where: { key: fresh } });
    expect(await db.tag.count()).toBe(await db.tag.count({ where: { ownerId: freshOwner?.id } }));
  });

  it('keeps an owner seen exactly 30 days ago', async () => {
    await newOwner();
    expect(await deleteStaleOwners(db, later(STALE_DAYS * DAY_MS))).toBe(0);
  });
});

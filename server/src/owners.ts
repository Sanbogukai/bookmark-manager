// Owners: one per browser. Creating one copies the samples in; every other request finds the
// owner by the key the browser sends; owners unseen for 30 days are removed.

// Makes the random key; a version 4 UUID has 122 random bits, too many to guess.
import { randomUUID } from 'node:crypto';
// The database client type.
import type { Db } from './db.ts';
// The bookmarks a new owner starts with.
import { SAMPLES, type Sample } from './samples.ts';

// Lengths of time, in milliseconds.
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;
// Owners not seen for this many days are deleted with everything they saved.
export const STALE_DAYS = 30;

// The moment `days` days before `from`.
function daysBefore(from: Date, days: number): Date {
  return new Date(from.getTime() - days * DAY_MS);
}

// Makes an owner holding a copy of `samples` and returns its key. Tests pass an empty list
// to start from nothing.
export async function createOwner(db: Db, now: Date, samples: Sample[] = SAMPLES): Promise<string> {
  // The key the browser will keep and send back with every request.
  const key = randomUUID();
  // Every tag the samples use, once each; a Set drops the repeats.
  const names = [...new Set(samples.flatMap((sample) => sample.tags))];

  // One transaction: the owner, its tags and its bookmarks are saved together or not at all.
  await db.$transaction(async (tx) => {
    // The owner and its tags in one nested write; `include` returns the tags with their ids.
    const owner = await tx.owner.create({
      data: { key, createdAt: now, lastSeenAt: now, tags: { create: names.map((name) => ({ name })) } },
      include: { tags: true },
    });
    // Tag name to tag id, for linking the bookmarks below.
    const tagIds = new Map(owner.tags.map((tag) => [tag.name, tag.id]));
    // The bookmarks, each linked to its tags through BookmarkTag rows. The tags already exist,
    // so this links by id instead of using connectOrCreate.
    await Promise.all(
      samples.map((sample, index) => {
        // Oldest first: the first sample is saved samples.length days ago, the last one day ago.
        const daysAgo = samples.length - index;
        return tx.bookmark.create({
          data: {
            ownerId: owner.id,
            url: sample.url,
            title: sample.title,
            description: sample.description,
            createdAt: daysBefore(now, daysAgo),
            // Read samples were read a day after they were saved.
            readAt: sample.read ? daysBefore(now, daysAgo - 1) : null,
            // flatMap drops a name with no id (impossible here, but the type allows it).
            tags: { create: sample.tags.flatMap((name) => tagIds.get(name) ?? []).map((tagId) => ({ tagId })) },
          },
        });
      }),
    );
  });
  return key;
}

// The id of the owner with this key, or null if there is none. It also records that the
// owner was seen, but writes only when the last record is over an hour old: one small write
// per hour of use instead of one per request, which is precise enough for a 30-day cutoff.
export async function findOwnerId(db: Db, key: string, now: Date): Promise<number | null> {
  const owner = await db.owner.findUnique({ where: { key }, select: { id: true, lastSeenAt: true } });
  if (owner === null) return null;
  // Only a stale record is refreshed.
  if (now.getTime() - owner.lastSeenAt.getTime() > HOUR_MS) {
    await db.owner.update({ where: { id: owner.id }, data: { lastSeenAt: now } });
  }
  return owner.id;
}

// Deletes owners not seen for STALE_DAYS days and returns how many went. Their bookmarks,
// tags and tag links go too: the foreign keys are ON DELETE CASCADE (onDelete: Cascade in
// the schema), so Postgres removes them in the same statement.
export async function deleteStaleOwners(db: Db, now: Date): Promise<number> {
  const { count } = await db.owner.deleteMany({ where: { lastSeenAt: { lt: daysBefore(now, STALE_DAYS) } } });
  return count;
}

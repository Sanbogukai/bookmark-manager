// Every bookmark and tag query. Each one takes the owner's id and puts it in its `where`, so
// one owner can never see or change another's rows.

// The database client type.
import type { Db } from './db.ts';
// Prisma's generated types and error classes.
import { Prisma } from './generated/prisma/client.ts';
// The shapes the API returns.
import type { Bookmark, BookmarkPage, TagCount } from '../../shared/types.ts';

// Bookmarks per page.
export const PAGE_SIZE = 24;

// Prisma's error code for a broken unique constraint.
const UNIQUE_VIOLATION = 'P2002';

// The read filter: everything, unread only (readAt is NULL) or read only.
export type Status = 'all' | 'unread' | 'read';

// Where the next page starts: just after the bookmark with this date and id.
export interface Cursor {
  createdAt: Date;
  id: number;
}

// What the list can be narrowed by. Several tags mean all of them.
export interface ListFilters {
  tags: string[];
  status: Status;
  q?: string;
  cursor?: Cursor;
}

// The fields of a new bookmark, already checked and normalised by the route.
export interface NewBookmark {
  url: string;
  title: string;
  description?: string | null;
  iconUrl?: string | null;
  tags: string[];
}

// What an edit may change; a missing field stays as it is.
export interface BookmarkChanges {
  title?: string;
  description?: string | null;
  tags?: string[];
  read?: boolean;
}

// Load a bookmark's tag links and, through them, the tags themselves.
const withTags = { tags: { include: { tag: true } } } as const satisfies Prisma.BookmarkInclude;
// A bookmark row as loaded with `withTags`.
type BookmarkRow = Prisma.BookmarkGetPayload<{ include: typeof withTags }>;
// Either the full client or the one inside a transaction; both run the same queries.
type Client = Db | Prisma.TransactionClient;

// The cursor's text form: the saved time in milliseconds, a dash, then the id.
// Example: "1795348800000-42" matches; "abc", "12-" and "-5" do not.
// Try it: https://regex101.com/?regex=%5E(%5Cd%7B1%2C15%7D)-(%5Cd%7B1%2C10%7D)%24&flavor=javascript&testString=1795348800000-42
export const CURSOR_PATTERN = /^(\d{1,15})-(\d{1,10})$/;

// The text form of a cursor, as sent to the client.
function encodeCursor(row: { createdAt: Date; id: number }): string {
  return `${row.createdAt.getTime()}-${row.id}`;
}

// Turns cursor text back into a date and id. The route has already matched CURSOR_PATTERN,
// so the two groups are always there.
export function decodeCursor(text: string): Cursor {
  const [, time = '0', id = '0'] = CURSOR_PATTERN.exec(text) ?? [];
  return { createdAt: new Date(Number(time)), id: Number(id) };
}

// The one form a link is stored and compared in, so the same page saved twice is caught as
// a duplicate. The URL parser already lower-cases the scheme and host, drops a default port
// (:443 on https) and writes an empty path as "/", so https://Example.com and
// https://example.com/ come out the same. The #fragment only points within the page, so it
// is dropped too. The query string is kept: it often picks the content.
export function normalizeUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = '';
  return url.href;
}

// A database row as the API returns it: tag names sorted, dates as ISO text.
function toBookmark(row: BookmarkRow): Bookmark {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    description: row.description,
    iconUrl: row.iconUrl,
    tags: row.tags.map((link) => link.tag.name).toSorted(),
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Tag links for a create or an edit. connectOrCreate links to the owner's tag of that name,
// making it first if it does not exist yet; all in the same statement as the bookmark.
function tagLinks(ownerId: number, names: string[]): Prisma.BookmarkTagCreateWithoutBookmarkInput[] {
  return names.map((name) => ({
    tag: {
      connectOrCreate: {
        where: { ownerId_name: { ownerId, name } },
        create: { name, owner: { connect: { id: ownerId } } },
      },
    },
  }));
}

// Deletes the owner's tags that no bookmark uses any more. `none: {}` means "with no
// BookmarkTag rows at all".
async function deleteUnusedTags(db: Client, ownerId: number): Promise<void> {
  await db.tag.deleteMany({ where: { ownerId, bookmarks: { none: {} } } });
}

// The status filter as a Prisma condition.
function statusFilter(status: Status): Prisma.BookmarkWhereInput {
  if (status === 'unread') return { readAt: null };
  if (status === 'read') return { readAt: { not: null } };
  return {};
}

// The search text with LIKE's special characters made plain. Prisma's `contains` becomes
// ILIKE '%text%' without escaping, so "100%" would match "1000" and "_" any one character.
// Postgres escapes with a backslash by default, so the backslash itself goes first.
function escapeLike(text: string): string {
  return text.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

// The text search: the words appear in the title or the URL, ignoring case (ILIKE in SQL).
function searchFilter(q: string | undefined): Prisma.BookmarkWhereInput {
  if (!q) return {};
  const text = escapeLike(q);
  return {
    OR: [{ title: { contains: text, mode: 'insensitive' } }, { url: { contains: text, mode: 'insensitive' } }],
  };
}

// Rows after the cursor in newest-first order: saved earlier, or saved at the same moment
// with a smaller id. This is keyset paging: it works from values, not a row count, so a
// bookmark added or deleted between pages cannot shift the next page.
function afterCursor(cursor: Cursor | undefined): Prisma.BookmarkWhereInput {
  if (!cursor) return {};
  return {
    OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }],
  };
}

// One page of the owner's bookmarks, newest first, narrowed by the filters.
export async function listBookmarks(db: Db, ownerId: number, filters: ListFilters): Promise<BookmarkPage> {
  const rows = await db.bookmark.findMany({
    where: {
      ownerId,
      // Every condition must hold. Each tag adds one "has this tag" test, so two tags mean
      // both (EXISTS subqueries in SQL).
      AND: [
        statusFilter(filters.status),
        searchFilter(filters.q),
        afterCursor(filters.cursor),
        ...filters.tags.map((name) => ({ tags: { some: { tag: { name } } } })),
      ],
    },
    include: withTags,
    // The id breaks ties between bookmarks saved at the same moment, so the order is total.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    // One more than a page: if it comes back, there is a next page.
    take: PAGE_SIZE + 1,
  });
  // The page itself, without the extra row.
  const items = rows.slice(0, PAGE_SIZE);
  // The next page starts after the last row shown.
  const last = items.at(-1);
  const nextCursor = rows.length > PAGE_SIZE && last ? encodeCursor(last) : null;
  return { items: items.map(toBookmark), nextCursor };
}

// Whether an error is Postgres refusing a duplicate in a unique column.
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_VIOLATION;
}

// Saves a bookmark with its tags, or returns the one already saved under that URL. Inserting
// and catching the clash is safer than checking first: two saves of the same link at once
// cannot both get through.
export async function createBookmark(
  db: Db,
  ownerId: number,
  input: NewBookmark,
  now: Date,
): Promise<{ created: Bookmark } | { existing: Bookmark }> {
  try {
    // One nested write: Prisma runs the bookmark insert and the tag links in one transaction.
    const row = await db.bookmark.create({
      data: {
        owner: { connect: { id: ownerId } },
        url: input.url,
        title: input.title,
        description: input.description ?? null,
        iconUrl: input.iconUrl ?? null,
        createdAt: now,
        tags: { create: tagLinks(ownerId, input.tags) },
      },
      include: withTags,
    });
    return { created: toBookmark(row) };
  } catch (err) {
    // Anything but a duplicate is a real fault.
    if (!isUniqueViolation(err)) throw err;
    const existing = await db.bookmark.findUnique({
      where: { ownerId_url: { ownerId, url: input.url } },
      include: withTags,
    });
    // A clash on something other than the URL (two new tags racing) is passed on as an error.
    if (existing === null) throw err;
    return { existing: toBookmark(existing) };
  }
}

// The new readAt for an edit: unchanged when `read` is not given, cleared when marked unread,
// and kept as the first time it was read when marked read again.
function readAtFor(read: boolean | undefined, current: Date | null, now: Date): Date | null | undefined {
  if (read === undefined) return undefined;
  if (!read) return null;
  return current ?? now;
}

// Applies the changes to one of the owner's bookmarks; null if the owner has no such bookmark.
export async function updateBookmark(
  db: Db,
  ownerId: number,
  id: number,
  changes: BookmarkChanges,
  now: Date,
): Promise<Bookmark | null> {
  // One transaction, so a failed edit leaves the tags as they were.
  return db.$transaction(async (tx) => {
    // Checks ownership; another owner's id looks the same as a missing one.
    const current = await tx.bookmark.findFirst({ where: { id, ownerId }, select: { readAt: true } });
    if (current === null) return null;
    // New tags replace the old set: drop every link, then add the new ones below.
    if (changes.tags) await tx.bookmarkTag.deleteMany({ where: { bookmarkId: id } });
    // undefined fields are left alone by Prisma.
    const row = await tx.bookmark.update({
      where: { id },
      data: {
        title: changes.title,
        description: changes.description,
        readAt: readAtFor(changes.read, current.readAt, now),
        tags: changes.tags ? { create: tagLinks(ownerId, changes.tags) } : undefined,
      },
      include: withTags,
    });
    // Tags the old set used and the new one does not may now be unused.
    if (changes.tags) await deleteUnusedTags(tx, ownerId);
    return toBookmark(row);
  });
}

// Deletes one of the owner's bookmarks; false if the owner has no such bookmark.
export async function deleteBookmark(db: Db, ownerId: number, id: number): Promise<boolean> {
  return db.$transaction(async (tx) => {
    // deleteMany, not delete: it takes the owner in its `where` and reports 0 instead of throwing.
    const { count } = await tx.bookmark.deleteMany({ where: { id, ownerId } });
    if (count === 0) return false;
    // Its tag links went with it (cascade), so its tags may now be unused.
    await deleteUnusedTags(tx, ownerId);
    return true;
  });
}

// The owner's tags with how many bookmarks carry each, in name order.
export async function listTags(db: Db, ownerId: number): Promise<TagCount[]> {
  const tags = await db.tag.findMany({
    where: { ownerId },
    // _count runs a COUNT over the tag's BookmarkTag rows.
    select: { name: true, _count: { select: { bookmarks: true } } },
    orderBy: { name: 'asc' },
  });
  return tags.map((tag) => ({ name: tag.name, count: tag._count.bookmarks }));
}

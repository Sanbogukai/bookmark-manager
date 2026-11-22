// The shapes the client and the server agree on. Both sides load this file with `import type`,
// so it disappears when the code runs and only the type checker reads it.

// Every error the API sends. `issues` is there for bad input (400), one entry per field.
export interface ApiError {
  error: string;
  issues?: { field: string; message: string }[];
}

// One saved link, as the API returns it.
export interface Bookmark {
  id: number;
  url: string;
  title: string;
  description: string | null;
  // The page's icon as an absolute URL, or null when it has none.
  iconUrl: string | null;
  // Tag names in alphabetical order.
  tags: string[];
  // When it was marked read (ISO date-time), or null while unread.
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// What the client sends to save a link. Only `url` and `title` are required.
export interface CreateBookmark {
  url: string;
  title: string;
  description?: string;
  iconUrl?: string;
  tags?: string[];
}

// What the client sends to change a bookmark; every field is optional.
export interface UpdateBookmark {
  title?: string;
  description?: string | null;
  tags?: string[];
  read?: boolean;
}

// One page of the list. `nextCursor` is the id to ask for next, or null on the last page.
export interface BookmarkPage {
  items: Bookmark[];
  nextCursor: number | null;
}

// A tag and how many of this owner's bookmarks carry it.
export interface TagCount {
  name: string;
  count: number;
}

// The details read from a page, to fill in the add form.
export interface Preview {
  title: string | null;
  description: string | null;
  iconUrl: string | null;
}

// The answer to POST /api/owners: the key the browser keeps and sends back.
export interface NewOwner {
  key: string;
}

// The bookmarks every new browser starts with, so the first visit shows a working list with
// tags, read and unread cards to filter. Each owner gets its own copy and can change or
// delete it freely.

// One sample. `read` marks it read one day after it was saved.
export interface Sample {
  // The page's address.
  url: string;
  // The title, as the page itself gives it.
  title: string;
  // A one-line summary.
  description: string;
  // Its tags.
  tags: string[];
  // Whether it starts as read.
  read: boolean;
}

// Eight stable pages about the tools this project uses, across six tags. Three are read.
// They are listed oldest first: the first was saved eight days ago and the last one day ago
// (see createOwner), so the list opens with a believable spread of dates.
export const SAMPLES: Sample[] = [
  {
    url: 'https://developer.mozilla.org/en-US/docs/Learn_web_development',
    title: 'Learn web development | MDN',
    description: 'A structured course in HTML, CSS and JavaScript, from the first page to frameworks.',
    tags: ['learning'],
    read: true,
  },
  {
    url: 'https://www.postgresql.org/docs/current/',
    title: 'PostgreSQL documentation',
    description: 'The reference for every SQL command, data type and setting in the current release.',
    tags: ['postgres', 'docs'],
    read: true,
  },
  {
    url: 'https://www.prisma.io/docs',
    title: 'Prisma ORM documentation',
    description: 'Schemas, migrations and typed queries, with guides for PostgreSQL.',
    tags: ['postgres', 'docs'],
    read: false,
  },
  {
    url: 'https://use-the-index-luke.com/no-offset',
    title: 'Paging through results without OFFSET',
    description: 'Why OFFSET gets slower and skips rows, and how keyset (cursor) paging avoids both.',
    tags: ['postgres', 'performance'],
    read: false,
  },
  {
    url: 'https://web.dev/learn/performance',
    title: 'Learn Performance | web.dev',
    description: 'A course on how pages load and how to make them load faster.',
    tags: ['performance', 'learning'],
    read: false,
  },
  {
    url: 'https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html',
    title: 'SSRF Prevention Cheat Sheet | OWASP',
    description: 'How a server that fetches URLs can be turned against private networks, and the defences.',
    tags: ['security', 'learning'],
    read: false,
  },
  {
    url: 'https://expressjs.com/en/guide/migrating-5.html',
    title: 'Moving to Express 5',
    description: 'What changed in Express 5: async error handling, path syntax and removed methods.',
    tags: ['node', 'docs'],
    read: true,
  },
  {
    url: 'https://nodejs.org/en/learn/typescript/run-natively',
    title: 'Running TypeScript natively | Node.js',
    description: 'How Node strips types to run .ts files directly, and what syntax it cannot strip.',
    tags: ['node', 'learning'],
    read: false,
  },
];

# Bookmark & Reading List Manager

Save links, tag them, and keep a reading list. Each browser gets its own private list, and the
server fills in a page's title, description and icon when you paste a link.

Work in progress — project 4 of a full-stack learning series.

## Stack

- **Server:** Node 26 (runs TypeScript directly), Express 5, Zod, Prisma 7 with the `pg` adapter
- **Database:** PostgreSQL 18 locally, Neon in production
- **Tests:** Vitest and Supertest against a real test database

## Run it locally

1. Install PostgreSQL 18 and create a role plus the `bookmarks_dev` and `bookmarks_test` databases.
2. In `server/`, copy `.env.example` to `.env` and `.env.test` (pointing at `bookmarks_test`).
3. Then:

```sh
cd server
npm install
npx prisma migrate dev
npm test
npm run dev
```

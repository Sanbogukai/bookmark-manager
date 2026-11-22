// Settings for the Prisma CLI (generate, migrate). The app itself never reads this file.

// Loads server/.env into process.env, since Prisma 7 no longer does that on its own.
import 'dotenv/config';
// defineConfig only adds type checking to the settings object.
import { defineConfig } from 'prisma/config';

export default defineConfig({
  // Where the schema and the migrations live.
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // Migrations need a direct connection, not a pooled one. Neon gives both: DIRECT_URL is
    // set on Render, and locally there is no pooler, so DATABASE_URL serves for both. An empty
    // string lets `prisma generate` run where no database is configured, such as in CI's
    // install step; it never connects.
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '',
  },
});

// Settings for Vitest, the test runner (npm test).

// defineConfig only adds type checking to the settings object; it changes nothing at run time.
import { defineConfig } from 'vitest/config';
// Reads a .env-style file into process.env.
import { config } from 'dotenv';

// Loads the test database's address from .env.test before anything else runs. Values already
// in the environment win, so CI (which has no .env.test) sets DATABASE_URL itself. The global
// setup and every test worker inherit process.env from here.
config({ path: '.env.test', quiet: true });

export default defineConfig({
  test: {
    // Test files live in test/ and end in .test.ts.
    include: ['test/**/*.test.ts'],
    // The server runs in Node, so the tests do too (not in a fake browser).
    environment: 'node',
    // Runs once before all tests: rebuilds the test database from the migrations.
    globalSetup: ['test/globalSetup.ts'],
    // Every test file shares one real database, so files run one after another; two at once
    // would empty each other's tables mid-test.
    fileParallelism: false,
  },
});

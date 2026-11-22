// The server's entry point: connects to the database, builds the app and starts listening.
// Node 26 runs this .ts file directly by stripping out the types; there is no build step.

// Loads server/.env into process.env for local development. On Render the variables are set
// in the dashboard and there is no .env file, which dotenv quietly accepts.
import 'dotenv/config';
// Builds the Express app with every route attached.
import { createApp } from './app.ts';
// Makes the Prisma client.
import { createDb } from './db.ts';

// Render (and other hosts) choose the port through PORT; 3000 is the local default.
const DEFAULT_PORT = 3000;
// Number() turns the text "10000" into 10000; `||` falls back when PORT is missing or not a number.
const PORT = Number(process.env.PORT) || DEFAULT_PORT;

// The database to use. Without it nothing works, so stop at once with a clear message.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set; copy .env.example to .env');

// The app over that database, with the real clock (the default).
const app = createApp({ db: createDb(databaseUrl) });

// Starts the HTTP server on PORT; the callback runs once it is ready.
app.listen(PORT, () => {
  // Confirms the server is up and where.
  console.log(`Listening on http://localhost:${PORT}`);
});

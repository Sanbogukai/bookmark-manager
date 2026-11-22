// The server's entry point: connects to the database, builds the app and starts listening.
// Node 26 runs this .ts file directly by stripping out the types; there is no build step.

// Loads server/.env into process.env for local development. On Render the variables are set
// in the dashboard and there is no .env file, which dotenv quietly accepts.
import 'dotenv/config';
// Builds the Express app with every route attached.
import { createApp } from './app.ts';
// Makes the Prisma client.
import { createDb } from './db.ts';
// The daily clean-up of owners nobody has used for 30 days.
import { DAY_MS, deleteStaleOwners } from './owners.ts';
// Checks whether the built client is there.
import { existsSync } from 'node:fs';
// Builds the client folder's full path from this file's folder.
import { resolve } from 'node:path';

// Render (and other hosts) choose the port through PORT; 3000 is the local default.
const DEFAULT_PORT = 3000;
// Number() turns the text "10000" into 10000; `||` falls back when PORT is missing or not a number.
const PORT = Number(process.env.PORT) || DEFAULT_PORT;

// The database to use. Without it nothing works, so stop at once with a clear message.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set; copy .env.example to .env');

// One client, shared by the app and the clean-up.
const db = createDb(databaseUrl);
// The built client, two folders up from server/src. Render's build step makes it; in
// development it is usually missing, because Vite serves the client, and then the app
// serves the API alone.
const builtClient = resolve(import.meta.dirname, '../../client/dist');
const clientDir = existsSync(builtClient) ? builtClient : undefined;

// The app over that database, with the real clock (the default), and the client when built.
const app = createApp({ db, clientDir });

// Removes stale owners and logs how many. A failure is logged and the server keeps running;
// the next day's run tries again.
async function cleanUp(): Promise<void> {
  try {
    const count = await deleteStaleOwners(db, new Date());
    console.log(`Removed ${count} owner(s) unseen for 30 days`);
  } catch (err) {
    console.error('Clean-up failed', err);
  }
}
// Once at start-up, then daily. unref() lets the process exit without waiting for the timer.
void cleanUp();
setInterval(cleanUp, DAY_MS).unref();

// Starts the HTTP server on PORT; the callback runs once it is ready.
// Express 5 hands a failure (such as the port already being in use) to the callback instead
// of throwing, so the callback checks for one and stops the process rather than claiming
// to be listening.
app.listen(PORT, (error?: Error) => {
  if (error) throw error;
  // Confirms the server is up and where.
  console.log(`Listening on http://localhost:${PORT}`);
});

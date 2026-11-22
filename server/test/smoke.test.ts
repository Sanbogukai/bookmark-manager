// The first tests: the app starts, reaches the database, and answers in JSON when things go wrong.

// describe groups tests; it defines one; expect checks a value; the hooks run around them.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
// Shared set-up and status codes.
import { BAD_REQUEST, NOT_FOUND, OK, db, makeApp, resetDb } from './helpers.ts';

// Every test starts with empty tables.
beforeEach(resetDb);
// Closes the connection pool so Vitest can exit.
afterAll(() => db.$disconnect());

describe('smoke', () => {
  it('reports healthy when the database answers', async () => {
    const { api } = makeApp();
    const res = await api.get('/api/health');
    expect(res.status).toBe(OK);
    expect(res.body).toEqual({ ok: true });
  });

  it('answers an unknown API route with a JSON 404', async () => {
    const { api } = makeApp();
    const res = await api.get('/api/nope');
    expect(res.status).toBe(NOT_FOUND);
    expect(res.body.error).toBe('No route for GET /api/nope');
  });

  it('answers a malformed JSON body with a JSON 400', async () => {
    const { api } = makeApp();
    // A body that claims to be JSON but is not.
    const res = await api.post('/api/anything').set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(BAD_REQUEST);
    expect(typeof res.body.error).toBe('string');
  });
});

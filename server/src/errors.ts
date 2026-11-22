// Errors a route throws to answer with a 4xx. The app's error handler turns them into JSON.

// The per-field problem shape, shared with the client.
import type { Issue } from '../../shared/types.ts';

// HTTP 400: the request was understood but its input is wrong.
const HTTP_BAD_REQUEST = 400;

// Bad input, with one issue per wrong field so the form can show each message beside its field.
export class InputError extends Error {
  // The status the error handler sends.
  readonly status = HTTP_BAD_REQUEST;
  // What was wrong, field by field.
  readonly issues: Issue[];

  constructor(issues: Issue[]) {
    // The summary line; the issues carry the detail.
    super('Some fields need fixing');
    this.issues = issues;
  }
}

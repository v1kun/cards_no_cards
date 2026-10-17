/**
 * Authentication errors.
 *
 * Kept separate from the data-access errors so API routes can map an
 * unauthenticated request to a 401 distinctly from authorization or
 * validation failures.
 */

export class UnauthorizedError extends Error {
  constructor(message = "Authentication is required.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

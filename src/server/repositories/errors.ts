/**
 * Domain-level errors for the data-access layer.
 *
 * Repositories throw these instead of leaking driver-specific errors, so
 * callers (API routes, services) can map them to consistent responses.
 */

export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`);
    this.name = "NotFoundError";
  }
}

export class OwnershipError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} is not owned by the requesting user: ${id}`);
    this.name = "OwnershipError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

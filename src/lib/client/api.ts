"use client";

/**
 * Minimal browser API client.
 *
 * Unwraps the `{ data, error, requestId }` envelope and throws a typed error
 * on failure so UI components can render error and retry states uniformly.
 */

export type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string } | null;
  requestId: string;
};

export class ApiClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiClientError("NETWORK", "Could not reach the server.", 0);
  }

  const body = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;

  if (!response.ok || !body || body.error) {
    throw new ApiClientError(
      body?.error?.code ?? "ERROR",
      body?.error?.message ?? "The request failed.",
      response.status,
    );
  }

  return body.data as T;
}

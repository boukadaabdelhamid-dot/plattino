import { ApiError } from "@workspace/api-client-react";

/**
 * Extract a user-facing message from an error thrown by a generated API
 * mutation/query hook. `ApiError` already carries a well-formatted message
 * (built from the server's `message`/`detail`/`title` fields, see
 * `custom-fetch.ts`), so we prefer that over a generic fallback.
 */
export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

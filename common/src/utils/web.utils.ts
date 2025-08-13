// ---------- Response Helpers ----------
export function success(statusCode: number, body: any) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function failure(
  statusCode: number,
  errorCode: string,
  message: string
) {
  return success(statusCode, { errorCode, message });
}

/**
 * Validates and normalizes an email address.
 * - Must be a non-empty string
 * - Trimmed
 * - Matches a basic email regex pattern
 * - Lowercased for consistent storage
 * @param value - Input value to validate.
 * @returns Normalized email string, or null if invalid.
 */
export function validateEmail(value: any): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();

  // Simple but effective email format check
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(trimmed)) return null;
  return trimmed;
}

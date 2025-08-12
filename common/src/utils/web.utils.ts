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

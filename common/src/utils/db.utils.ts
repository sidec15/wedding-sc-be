// ---------- Cursor helpers (opaque base64 JSON) ----------
export function encodeCursor(lek?: Record<string, any>) {
  return lek
    ? Buffer.from(JSON.stringify(lek), "utf8").toString("base64")
    : undefined;
}

export function decodeCursor(cursor?: string): Record<string, any> | undefined {
  if (!cursor) return undefined;
  try {
    return JSON.parse(Buffer.from(cursor, "base64").toString("utf8"));
  } catch {
    return undefined; // invalid cursor → treated as "no cursor"
  }
}

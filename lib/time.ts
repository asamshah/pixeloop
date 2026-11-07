// SQLite datetime('now') is UTC text without a zone marker.
export function parseDbDate(s: string): Date {
  return new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z");
}

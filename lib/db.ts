import { createClient, type Client } from "@libsql/client";
import { mkdirSync } from "node:fs";

// Local SQLite file by default. Point DATABASE_URL at Turso (libsql://...) for
// hosted use; the SQL below is portable.
let client: Client | null = null;
let ready: Promise<void> | null = null;

function getClient(): Client {
  if (!client) {
    const url = process.env.DATABASE_URL ?? "file:./data/ads-agent.db";
    if (url.startsWith("file:")) mkdirSync("data", { recursive: true });
    client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });
  }
  return client;
}

async function addColumn(db: Client, table: string, col: string, def: string) {
  try {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  } catch {
    // already exists
  }
}

async function migrate(db: Client) {
  await db.batch(
    [
      `CREATE TABLE IF NOT EXISTS connections (
        tenant_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        credentials_enc TEXT NOT NULL,
        display_name TEXT,
        status TEXT NOT NULL DEFAULT 'connected',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (tenant_id, platform)
      )`,
      `CREATE TABLE IF NOT EXISTS settings (
        tenant_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (tenant_id, key)
      )`,
      `CREATE TABLE IF NOT EXISTS overlay_snapshots (
        tenant_id TEXT PRIMARY KEY,
        computed_at TEXT NOT NULL,
        data TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS snapshots (
        tenant_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        computed_at TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (tenant_id, kind)
      )`,
      `CREATE TABLE IF NOT EXISTS audits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        window_days INTEGER NOT NULL,
        summary TEXT,
        total_estimated_saving REAL NOT NULL DEFAULT 0,
        finding_count INTEGER NOT NULL DEFAULT 0,
        trigger TEXT NOT NULL DEFAULT 'manual',
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS recommendations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        audit_id INTEGER NOT NULL,
        platform TEXT NOT NULL DEFAULT 'google_ads',
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        rationale TEXT NOT NULL,
        estimated_saving REAL NOT NULL DEFAULT 0,
        action_json TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        result TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        decided_at TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_rec_tenant_status ON recommendations (tenant_id, status)`,
      `CREATE TABLE IF NOT EXISTS action_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        recommendation_id INTEGER,
        action_json TEXT NOT NULL,
        dry_run INTEGER NOT NULL,
        ok INTEGER NOT NULL,
        message TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
    ],
    "write",
  );
  // Upgrades for databases created by the first version of the app.
  await addColumn(db, "audits", "finding_count", "INTEGER NOT NULL DEFAULT 0");
  await addColumn(db, "audits", "trigger", "TEXT NOT NULL DEFAULT 'manual'");
  await addColumn(db, "audits", "error", "TEXT");
  await addColumn(db, "recommendations", "platform", "TEXT NOT NULL DEFAULT 'google_ads'");
}

export async function db(): Promise<Client> {
  const c = getClient();
  ready ??= migrate(c);
  await ready;
  return c;
}

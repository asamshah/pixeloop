import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// Credentials are encrypted with AES-256-GCM before they touch the database.
// Production: set ENCRYPTION_KEY (32 bytes, base64 or hex).
// Local dev: a key is generated once and kept in data/.secret-key.
let cached: Buffer | null = null;

function parseKey(raw: string): Buffer {
  const trimmed = raw.trim();
  const buf = /^[0-9a-f]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");
  if (buf.length !== 32) {
    throw new Error("ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  return buf;
}

function getKey(): Buffer {
  if (cached) return cached;
  if (process.env.ENCRYPTION_KEY) {
    cached = parseKey(process.env.ENCRYPTION_KEY);
    return cached;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "ENCRYPTION_KEY is required in production (generate: openssl rand -base64 32)",
    );
  }
  const file = path.join(process.cwd(), "data", ".secret-key");
  if (existsSync(file)) {
    cached = parseKey(readFileSync(file, "utf8"));
  } else {
    mkdirSync(path.dirname(file), { recursive: true });
    cached = randomBytes(32);
    writeFileSync(file, cached.toString("base64"), { mode: 0o600 });
  }
  return cached;
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

export function decrypt(payload: string): string {
  const [iv, tag, data] = payload.split(".").map((p) => Buffer.from(p, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

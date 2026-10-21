import { DatabaseSync } from 'node:sqlite';

export function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, phone TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student' CHECK(role IN ('student','admin')),
      approval TEXT NOT NULL DEFAULT 'pending' CHECK(approval IN ('pending','approved','rejected')),
      phone_verified_at INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS challenges (
      token_hash TEXT PRIMARY KEY, phone TEXT NOT NULL, name TEXT NOT NULL,
      sid TEXT, expires INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'sending'
    );
    CREATE TABLE IF NOT EXISTS consumed_verifications (sid TEXT PRIMARY KEY, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS approval_audit (
      id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, decision TEXT NOT NULL, actor TEXT NOT NULL, at INTEGER NOT NULL
    );`);
  return db;
}

// All counters are reserved together before making an external call. They survive restarts.
export function reserveLimits(db, entries, now) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [key, maximum, duration] of entries) {
      const row = db.prepare('SELECT count, expires FROM limits WHERE key=?').get(key);
      if (row && row.expires > now && row.count >= maximum) {
        const error = new Error('RATE_LIMITED');
        error.status = 429;
        error.retryAfter = Math.ceil((row.expires - now) / 1000);
        throw error;
      }
      db.prepare(`INSERT INTO limits(key,count,expires) VALUES (?,1,?)
        ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<=? THEN 1 ELSE count+1 END,
        expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END`).run(key, now + duration, now, now);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function cleanup(db, now) {
  for (const table of ['limits', 'sessions', 'challenges', 'consumed_verifications'])
    db.prepare(`DELETE FROM ${table} WHERE expires<=?`).run(now);
}

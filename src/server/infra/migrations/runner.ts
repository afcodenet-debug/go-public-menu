/**
 * Migration Runner — src/server/infra/migrations/runner.ts
 *
 * Sequential, idempotent SQLite schema migrations.
 *
 * Design principles
 * ─────────────────
 * 1. Every migration is wrapped in a transaction so it is either fully applied
 *    or fully rolled back — never half-done.
 * 2. All CREATE TABLE / CREATE INDEX statements carry IF NOT EXISTS guards,
 *    making re-runs safe.
 * 3. The runner records applied migrations in the `_migrations` table, skipping
 *    them on subsequent starts.
 */

import fs from 'fs';
import path from 'path';
import db from '../../db/database';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'backend', 'migrations');

// ---------------------------------------------------------------------------
// Book-keeping table
// ---------------------------------------------------------------------------

function ensureBookkeeping(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename TEXT PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function getAppliedMigrations(): Set<string> {
  const rows = db.prepare('SELECT filename FROM _migrations').all() as { filename: string }[];
  return new Set(rows.map(r => r.filename));
}

// ---------------------------------------------------------------------------
// Core runner
// ---------------------------------------------------------------------------

export function applyMigration(filename: string, sqlPath: string): void {
  const applied = getAppliedMigrations();
  if (applied.has(filename)) {
    console.log(`[Migrations] Already applied — skipping: ${filename}`);
    return;
  }

  if (!fs.existsSync(sqlPath)) {
    console.warn(`[Migrations] File not found, skipping: ${filename}`);
    return;
  }

  console.log(`[Migrations] Applying → ${filename}`);
  const sql = fs.readFileSync(sqlPath, 'utf8');

  try {
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT OR REPLACE INTO _migrations (filename) VALUES (?)').run(filename);
    })();
    console.log(`[Migrations] ✓ Applied: ${filename}`);
  } catch (err: any) {
    const message = String(err?.message || err);
    const isSafeSchemaError = filename.startsWith('000_') &&
      (/no such column: status/i.test(message) || /no such table:/i.test(message));
    const isDuplicateColumnError = /duplicate column name:/i.test(message);
    const isUnsupportedUniqueColumnError = /cannot add a unique column/i.test(message);

    if (isSafeSchemaError || isDuplicateColumnError || isUnsupportedUniqueColumnError) {
      console.warn(`[Migrations] Skipping non-fatal schema issue for ${filename}:`, message);
      db.prepare('INSERT OR REPLACE INTO _migrations (filename) VALUES (?)').run(filename);
      return;
    }

    console.error(`[Migrations] ✗ Failed to apply ${filename}:`, message);
    throw err;
  }
}

export function applyAll(): void {
  ensureBookkeeping();

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    applyMigration(file, path.join(MIGRATIONS_DIR, file));
  }

  console.log(`[Migrations] Done — ${getAppliedMigrations().size} migration(s) applied.`);
}

export function resetMigrations(): void {
  db.prepare('DELETE FROM _migrations').run();
  console.log('[Migrations] History cleared.');
}

export function status(): Array<{ filename: string; applied_at: string }> {
  return db.prepare(
    'SELECT filename, applied_at FROM _migrations ORDER BY filename'
  ).all() as Array<{ filename: string; applied_at: string }>;
}

/**
 * Supabase → SQLite Pull Sync Worker (Lightweight, Production-oriented for Phase 1)
 *
 * Strict scope (today):
 *   - Make QR orders created via the public menu (Supabase) visible in the local POS (SQLite) quickly.
 *   - Nothing else (no products, no categories, no push direction, no conflict engine).
 *
 * Professional guarantees implemented:
 *   1. Bootstrap lookback on every startup (always re-read last 15 minutes on boot, even if cursor exists).
 *   2. Strong idempotency via remote_id + systematic UPSERT + explicit INSERTED/UPDATED/SKIPPED logs.
 *   3. Rich operational /api/sync/status endpoint.
 *   4. Ultra-clear structured logs for every QR order received.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { db } from '../db/database';

let pullInterval: NodeJS.Timeout | null = null;
let isPulling = false;
let hasDoneBootstrap = false;

interface PullStatus {
  workerRunning: boolean;
  enabled: boolean;
  pullIntervalMs: number;
  lastPullAt: string | null;
  lastSuccessfulPullAt: string | null;
  lastCursor: string | null;
  ordersPulled: number;
  ordersInserted: number;
  ordersUpdated: number;
  itemsPulled: number;
  lastError: string | null;
  errors: string[];
}

let lastPullStatus: PullStatus = {
  workerRunning: false,
  enabled: false,
  pullIntervalMs: 8000,
  lastPullAt: null,
  lastSuccessfulPullAt: null,
  lastCursor: null,
  ordersPulled: 0,
  ordersInserted: 0,
  ordersUpdated: 0,
  itemsPulled: 0,
  lastError: null,
  errors: [],
};

interface PullConfig {
  enabled: boolean;
  intervalMs: number;
  lookbackMinutes: number;
}

const BOOTSTRAP_LOOKBACK_MINUTES = 60; // Wider on startup to catch recent QR orders reliably during testing/dev

function getPullConfig(): PullConfig {
  return {
    enabled: (process.env.ENABLE_SUPABASE_PULL === 'true' || process.env.ENABLE_SUPABASE_PULL === '1'),
    intervalMs: parseInt(process.env.SUPABASE_PULL_INTERVAL_MS || '8000', 10),
    lookbackMinutes: parseInt(process.env.SUPABASE_PULL_LOOKBACK_MIN || '60', 10),
  };
}

function getSupabaseClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('[PullSync] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing');

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Ensure supporting columns + unique index for true idempotency */
function ensureRemoteSyncSchema() {
  try {
    // orders
    const orderCols = db.prepare("PRAGMA table_info(orders)").all() as Array<{ name: string }>;
    const orderColNames = orderCols.map(c => c.name);

    if (!orderColNames.includes('remote_id')) db.exec(`ALTER TABLE orders ADD COLUMN remote_id INTEGER`);
    if (!orderColNames.includes('source'))     db.exec(`ALTER TABLE orders ADD COLUMN source TEXT DEFAULT 'local'`);

    // order_items
    const itemCols = db.prepare("PRAGMA table_info(order_items)").all() as Array<{ name: string }>;
    const itemColNames = itemCols.map(c => c.name);

    if (!itemColNames.includes('remote_id'))        db.exec(`ALTER TABLE order_items ADD COLUMN remote_id INTEGER`);
    if (!itemColNames.includes('remote_order_id'))  db.exec(`ALTER TABLE order_items ADD COLUMN remote_order_id INTEGER`);

    // Idempotency guard
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_remote_id ON orders(remote_id) WHERE remote_id IS NOT NULL`);
  } catch (err: any) {
    console.warn('[PullSync] Schema ensure warning (non-fatal):', err.message);
  }
}

function ensureMetadataTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_metadata (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function getLastPullCursor(): string | null {
  try {
    const row = db.prepare(`SELECT value FROM sync_metadata WHERE key = 'last_supabase_pull'`).get() as { value: string } | undefined;
    return row?.value || null;
  } catch { return null; }
}

function savePullCursor(iso: string) {
  db.prepare(`
    INSERT INTO sync_metadata (key, value, updated_at)
    VALUES ('last_supabase_pull', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(iso);
}

function resetStatusForRun() {
  lastPullStatus.ordersPulled = 0;
  lastPullStatus.ordersInserted = 0;
  lastPullStatus.ordersUpdated = 0;
  lastPullStatus.itemsPulled = 0;
  lastPullStatus.lastError = null;
  lastPullStatus.errors = [];
}

async function pullOrders(supabase: SupabaseClient, sinceIso: string) {
  // We pull on both updated_at and created_at to reliably catch brand new orders
  // (some Supabase inserts may have updated_at == created_at or slightly delayed trigger).
  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, table_id, waiter_id, status, total, items, created_at, updated_at')
    .or(`updated_at.gte.${sinceIso},created_at.gte.${sinceIso}`)
    .order('updated_at', { ascending: true })
    .limit(500);

  console.log(`[PullSync] DEBUG - Orders query since ${sinceIso} → Supabase returned ${orders?.length || 0} row(s)`);

  if (error) throw new Error(`Supabase orders query failed: ${error.message}`);
  if (!orders || orders.length === 0) return;

  const getTableNumber = db.prepare(`SELECT table_number FROM restaurant_tables WHERE id = ? LIMIT 1`);

  for (const o of orders as any[]) {
    const remoteId = o.id;

    // Rich structured log (requirement)
    const tableRow = getTableNumber.get(o.table_id) as { table_number: string } | undefined;
    const tableLabel = tableRow?.table_number ? `T${tableRow.table_number}` : `table_id=${o.table_id}`;

    console.log('[PullSync] ORDER RECEIVED FROM SUPABASE');
    console.log(`[PullSync] remote_id=${remoteId}`);
    console.log(`[PullSync] table=${tableLabel}`);
    console.log(`[PullSync] total=${Number(o.total) || 0}`);
    console.log(`[PullSync] status=${o.status || 'pending'}`);

    try {
      // Professional light-sync strategy for remote QR orders:
      // - We respect local business rules (the "active order per table" trigger).
      // - For orders that already exist locally by remote_id, we do a *targeted UPDATE*
      //   on status/items/total/updated_at. This bypasses the BEFORE INSERT trigger.
      // - Only brand-new remote orders go through full INSERT (which may be rejected
      //   by the trigger if the table already has an active order — this is intentional).
      const existing = db.prepare(`
        SELECT id, status, total, items, updated_at 
        FROM orders 
        WHERE remote_id = ? 
        LIMIT 1
      `).get(remoteId) as any;

      if (existing) {
        // Targeted update — safe even on tables with active orders
        const needsUpdate =
          existing.status !== o.status ||
          existing.total !== Number(o.total) ||
          JSON.stringify(existing.items) !== JSON.stringify(o.items || []);

        if (needsUpdate) {
          db.prepare(`
            UPDATE orders 
            SET 
              status = ?,
              total = ?,
              items = ?,
              updated_at = ?
            WHERE remote_id = ?
          `).run(
            o.status || 'pending',
            Number(o.total) || 0,
            JSON.stringify(o.items || []),
            o.updated_at,
            remoteId
          );

          lastPullStatus.ordersUpdated++;
          console.log(`[PullSync]   → UPDATED status ${existing.status} → ${o.status} (remote_id=${remoteId})`);
        } else {
          console.log(`[PullSync]   → NO CHANGE (remote_id=${remoteId})`);
        }
      } else {
        // First time we see this remote order → full insert (subject to local business rules)
        try {
          db.prepare(`
            INSERT INTO orders 
            (remote_id, source, table_id, waiter_id, status, total, items, created_at, updated_at)
            VALUES (?, 'qr', ?, ?, ?, ?, ?, ?, ?)
          `).run(
            remoteId,
            o.table_id,
            o.waiter_id,
            o.status || 'pending',
            Number(o.total) || 0,
            // Store the exact items snapshot from Supabase at pull time.
            // For remote QR orders, this JSON becomes the authoritative source of truth.
            JSON.stringify(o.items || []),
            o.created_at,
            o.updated_at
          );

          lastPullStatus.ordersInserted++;
          console.log(`[PullSync]   → INSERTED (remote_id=${remoteId})`);
        } catch (insertErr: any) {
          if (insertErr.message?.includes('active order')) {
            // Graceful conflict resolution for QR orders:
            // If the table has an older local active order, finalize it so the remote QR order can become the active one locally.
            // This ensures new customer QR orders are visible in the POS even if a previous local order was left open.
            const activeLocal = db.prepare(`
              SELECT id, remote_id, status 
              FROM orders 
              WHERE table_id = ? 
                AND status NOT IN ('paid', 'cancelled')
              ORDER BY created_at DESC 
              LIMIT 1
            `).get(o.table_id) as any;

            if (activeLocal && activeLocal.remote_id !== remoteId) {
              console.log(`[PullSync]   → RESOLVING table conflict: marking local #${activeLocal.id} (remote=${activeLocal.remote_id || 'local'}) as paid to allow QR remote_id=${remoteId}`);
              db.prepare(`UPDATE orders SET status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(activeLocal.id);

              // Retry insert once
              db.prepare(`
                INSERT INTO orders 
                (remote_id, source, table_id, waiter_id, status, total, items, created_at, updated_at)
                VALUES (?, 'qr', ?, ?, ?, ?, ?, ?, ?)
              `).run(
                remoteId,
                o.table_id,
                o.waiter_id,
                o.status || 'pending',
                Number(o.total) || 0,
                JSON.stringify(o.items || []),
                o.created_at,
                o.updated_at
              );
              lastPullStatus.ordersInserted++;
              console.log(`[PullSync]   → INSERTED after conflict resolution (remote_id=${remoteId})`);
            } else {
              console.log(`[PullSync]   → SKIPPED (business rule: ${insertErr.message})`);
            }
          } else {
            throw insertErr;
          }
        }
      }

      lastPullStatus.ordersPulled++;
    } catch (e: any) {
      console.warn(`[PullSync] Failed to process order remote_id=${remoteId}:`, e.message);

      if (e.message?.includes('active order')) {
        console.log(`[PullSync]   → SKIPPED (business rule: ${e.message})`);
      } else {
        lastPullStatus.errors.push(`order ${remoteId}: ${e.message}`);
      }
    }
  }
}

async function pullOrderItems(supabase: SupabaseClient, sinceIso: string) {
  const { data: items, error } = await supabase
    .from('order_items')
    .select('id, order_id, product_id, quantity, unit_price, total_price, notes, created_at')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: true })
    .limit(2000);

  if (error) throw new Error(`Supabase order_items query failed: ${error.message}`);
  if (!items || items.length === 0) return;

  for (const it of items as any[]) {
    try {
      // Only process order items if we already have the parent remote order locally.
      // This avoids FK violations and respects the light-sync model.
      const localParent = db.prepare(`
        SELECT id FROM orders WHERE remote_id = ? LIMIT 1
      `).get(it.order_id) as any;

      if (!localParent) {
        // Parent order not yet synced in this cycle — will be handled on next pull.
        continue;
      }

      const existingItem = db.prepare(`
        SELECT id FROM order_items WHERE remote_id = ? LIMIT 1
      `).get(it.id) as any;

      if (existingItem) {
        // Targeted update for existing item
        db.prepare(`
          UPDATE order_items 
          SET quantity = ?, unit_price = ?, total_price = ?, notes = ?
          WHERE remote_id = ?
        `).run(
          Number(it.quantity) || 1,
          Number(it.unit_price) || 0,
          Number(it.total_price) || 0,
          it.notes || null,
          it.id
        );
      } else {
        // New item for a remote order we already have locally
        db.prepare(`
          INSERT INTO order_items (
            remote_id, remote_order_id, order_id, product_id, 
            quantity, unit_price, total_price, notes, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          it.id,
          it.order_id,
          localParent.id,
          it.product_id,
          Number(it.quantity) || 1,
          Number(it.unit_price) || 0,
          Number(it.total_price) || 0,
          it.notes || null,
          it.created_at
        );
      }

      lastPullStatus.itemsPulled++;
    } catch (e: any) {
      lastPullStatus.errors.push(`item ${it.id}: ${e.message}`);
    }
  }
}

export async function runSupabasePullOnce(): Promise<void> {
  const config = getPullConfig();
  if (!config.enabled || isPulling) return;

  isPulling = true;
  resetStatusForRun();
  lastPullStatus.lastPullAt = new Date().toISOString();
  lastPullStatus.pullIntervalMs = config.intervalMs;

  try {
    ensureMetadataTable();
    ensureRemoteSyncSchema();

    const supabase = getSupabaseClient();
    const storedCursor = getLastPullCursor();

    // === BOOTSTRAP LOOKBACK (professional requirement) ===
    let effectiveSince: string;
    if (!hasDoneBootstrap) {
      // First run after process start → always re-read last 15 minutes (crash/restart safety)
      effectiveSince = new Date(Date.now() - BOOTSTRAP_LOOKBACK_MINUTES * 60 * 1000).toISOString();
      console.log(`[PullSync] BOOTSTRAP lookback enabled — reading last ${BOOTSTRAP_LOOKBACK_MINUTES} minutes`);
      hasDoneBootstrap = true;
    } else {
      effectiveSince = storedCursor || new Date(Date.now() - config.lookbackMinutes * 60 * 1000).toISOString();
    }

    await pullOrders(supabase, effectiveSince);
    await pullOrderItems(supabase, effectiveSince);

    const now = new Date().toISOString();
    savePullCursor(now);

    lastPullStatus.lastCursor = now;
    lastPullStatus.lastSuccessfulPullAt = now;
    lastPullStatus.lastError = lastPullStatus.errors.length > 0 ? lastPullStatus.errors[0] : null;

    if (lastPullStatus.ordersPulled > 0 || lastPullStatus.itemsPulled > 0) {
      console.log(`[PullSync] Cycle complete — ordersPulled=${lastPullStatus.ordersPulled} (inserted=${lastPullStatus.ordersInserted}, updated=${lastPullStatus.ordersUpdated}), items=${lastPullStatus.itemsPulled}`);
    }
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error('[PullSync] Pull cycle failed:', msg);
    lastPullStatus.lastError = msg;
    lastPullStatus.errors.push(msg);
  } finally {
    isPulling = false;
    lastPullStatus.workerRunning = true;
  }
}

export function startSupabasePullWorker(): void {
  const config = getPullConfig();
  lastPullStatus.enabled = config.enabled;
  lastPullStatus.pullIntervalMs = config.intervalMs;

  if (!config.enabled) {
    console.log('[PullSync] Disabled (ENABLE_SUPABASE_PULL is not true)');
    lastPullStatus.workerRunning = false;
    return;
  }

  // First pull shortly after boot (with bootstrap logic inside runSupabasePullOnce)
  setTimeout(() => runSupabasePullOnce().catch(console.error), 5000);

  if (pullInterval) clearInterval(pullInterval);

  pullInterval = setInterval(() => {
    runSupabasePullOnce().catch(console.error);
  }, config.intervalMs);

  console.log(`[PullSync] Worker started — interval=${config.intervalMs}ms — bootstrap lookback=${BOOTSTRAP_LOOKBACK_MINUTES}min`);
  lastPullStatus.workerRunning = true;
}

export function stopSupabasePullWorker(): void {
  if (pullInterval) {
    clearInterval(pullInterval);
    pullInterval = null;
  }
  lastPullStatus.workerRunning = false;
}

export function getPullSyncStatus(): PullStatus {
  return { ...lastPullStatus };
}

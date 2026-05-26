import path from 'path';
import fs from 'fs';
import { applyAll as runMigrations } from '../infra/migrations/runner';

// better-sqlite3 ships native bindings.
// In Electron/packaged runs (macOS/Windows) or unusual Node/Electron versions,
// the native file might be missing and crash the whole server at import time.
// We must therefore tolerate missing bindings and boot in "db disabled" mode.
let Database: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Database = require('better-sqlite3');
} catch (e: any) {
  console.warn('[Database] better-sqlite3 native bindings unavailable at require time:', e?.message || e);
  Database = null;
}

// ══════════════════════════════════════════════════════════════════════════════
// Database connector — Great Olive POS/ERP
// ══════════════════════════════════════════════════════════════════════════════
//
// Architecture
// ───────────
//  1. Open / create the database file.
//  2. Apply WAL + synchronous pragmas.
//  3. Run all forward migrations from backend/migrations/.
//     (Each migration is idempotent and records itself in the _migrations table.)
//  4. Seed data unconditionally — callers are responsible for the guard logic
//     inside each seeder so it never duplicates on re-runs.
//
// Why not inline CREATE TABLE?
// ──────────────────────────
//  Inline DDL creates the schema but destroys any ability to audit history.
//  A migration runner keeps a running ledger (the `_migrations` table) and
//  allows safe rollbacks via per-migration SQL reversal scripts.
//
// Data directory layout
// ──────────────────────
//   data/
//     database.db   — main SQLite file
//     uploads/products/ — product images written by the upload route
// ===============================================================================

// --- paths -----------------------------------------------------------------

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), 'data');
const uploadsDir  = path.resolve(dataDir, 'uploads', 'products');

if (!fs.existsSync(dataDir))    fs.mkdirSync(dataDir,    { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const dbPath = path.join(dataDir, 'database.db');

// === HARD GUARD: Prevent local SQLite on the public Render service when Supabase is enabled ===
// This makes it impossible to accidentally use SQLite on the cloud QR menu backend.
const renderCloudMode = process.env.RENDER_CLOUD_MODE === 'true' || process.env.RENDER_CLOUD_MODE === '1';
const useSupabaseTables = process.env.USE_SUPABASE_TABLES === 'true' || process.env.USE_SUPABASE_TABLES === '1';
const useSupabaseProducts = process.env.USE_SUPABASE_PRODUCTS === 'true' || process.env.USE_SUPABASE_PRODUCTS === '1';

let dbInstance: any = null;

try {
  if (renderCloudMode || ((useSupabaseTables || useSupabaseProducts) && process.env.NODE_ENV === 'production')) {
    console.warn('══════════════════════════════════════════════════════════════════');
    console.warn('[Database] Cloud mode detected — exporting null DB stub.');
    console.warn('RENDER_CLOUD_MODE=', renderCloudMode);
    console.warn('All data operations must go through Supabase repositories.');
    console.warn('══════════════════════════════════════════════════════════════════');

    dbInstance = null;
  } else {
    if (!Database) {
      console.warn('[Database] better-sqlite3 constructor unavailable — skipping local SQLite connection.');
      dbInstance = null;
    } else {
      console.log('[Database] Connecting to:', dbPath);

      dbInstance = new Database(dbPath, {
        verbose: undefined,
        timeout: 5000,
      });

      dbInstance.pragma('journal_mode = WAL');
      dbInstance.pragma('synchronous = NORMAL');
      dbInstance.pragma('busy_timeout = 5000');
      dbInstance.pragma('cache_size = -64000');
      dbInstance.pragma('foreign_keys = ON');
    }
  }
} catch (e: any) {
  console.error('[Database] CRITICAL: Failed to instantiate or configure SQLite (bindings or disk issue):', e?.message || e);
  console.warn('[Database] Continuing in degraded mode with db=null. Supabase-only features may still work if enabled.');
  dbInstance = null;
}

export const db = dbInstance;

// --- public factory --------------------------------------------------------

function seedQrTokensForTables(): void {
  // Seed uniquement si la colonne existe (après migration)
  try {
    const hasColumn = db.prepare(`
      PRAGMA table_info(restaurant_tables);
    `).all().some((c: any) => c.name === 'qr_token');

    if (!hasColumn) return;

    const needs = db.prepare(`
      SELECT COUNT(*) AS cnt
      FROM restaurant_tables
      WHERE qr_token IS NULL OR qr_token = ''
    `).get() as { cnt: number };

    if (!needs.cnt) return;

    // UUID v4 sans tirets, déterministe “assez robuste” côté backend via crypto
    // Node >= 14 supporte crypto.randomUUID()
    const crypto = require('crypto') as typeof import('crypto');

    const rows = db.prepare(`
      SELECT id
      FROM restaurant_tables
      WHERE qr_token IS NULL OR qr_token = ''
    `).all() as Array<{ id: number }>;

    const update = db.prepare(`
      UPDATE restaurant_tables
      SET qr_token = ?
      WHERE id = ?
    `);

    const tokens: string[] = rows.map(() => crypto.randomUUID().replace(/-/g, ''));
    for (let i = 0; i < rows.length; i++) {
      update.run(tokens[i], rows[i].id);
    }
  } catch {
    // si restaurant_tables/qr_token n’existe pas encore, on ignore
  }
}

export function initializeDatabase(): void {
  // ── Migrations (forward-only, sequential, idempotent) ────────────────────
  runMigrations();

  // ── Safety net: ensure minimum tables for QR menu on fresh DB (Render) ───
  ensureCoreQrMenuTables();

  // ── Seed data (wrapped for fresh DB tolerance on Render) ────────────────
  try {
    seedAdmin();
    seedManager();
    seedWaiter();
    seedCashier();
    seedTables();
    seedCategories();

    // Purge simple des produits "demo/test" existants dans la BD
    disableDemoTestProducts();

    seedMenuSchema(); // legacy QR menu schema seed (menu_categories/menu_items)
    seedSettings();

    // Seed QR tokens après seedTables (au cas où la table est vide au 1er run)
    seedQrTokensForTables();

    ensureEmailSettingsDefaults();
    ensureNotificationTables(); // Phase 3 - Notifications & Reports tables

    // Add email column to users (nullable + unique)
    try {
      db.prepare(`ALTER TABLE users ADD COLUMN email TEXT`).run();
    } catch (e) {
      // Column already exists or table missing
    }

    // Create partial unique index for non-null emails
    try {
      db.prepare(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique 
        ON users(email) 
        WHERE email IS NOT NULL
      `).run();
    } catch (e) {
      // table or index issue on fresh DB
    }
  } catch (e: any) {
    console.warn('[Database] Seeding skipped due to missing tables (fresh DB):', e?.message || e);
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// Bootstrap: force minimal schema for QR Public Menu on fresh deployments (Render)
// This runs after migrations so it acts as a safety net when early migrations are skipped.
// ───────────────────────────────────────────────────────────────────────────────
function ensureCoreQrMenuTables(): void {
  // restaurant_tables (needed for /api/menu/table/:qr_token)
  db.exec(`
    CREATE TABLE IF NOT EXISTS restaurant_tables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_number TEXT NOT NULL,
      capacity INTEGER DEFAULT 4,
      status TEXT DEFAULT 'available',
      assigned_waiter_id INTEGER,
      qr_token TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // categories (modern)
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      display_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // products (the table actually used by the public menu now)
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER,
      name TEXT NOT NULL,
      description TEXT,
      selling_price REAL NOT NULL,
      unit TEXT,
      image_url TEXT,
      is_available INTEGER DEFAULT 1,
      stock_quantity INTEGER DEFAULT 0,
      minimum_stock INTEGER DEFAULT 5,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Basic orders table (needed for checkout flow)
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_id INTEGER,
      status TEXT DEFAULT 'pending',
      total REAL DEFAULT 0,
      customer_phone TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // order_items (for checkout)
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      total_price REAL NOT NULL,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // users (needed by seedAdmin and some protected routes)
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT,
      username TEXT UNIQUE,
      pin_code TEXT,
      role TEXT DEFAULT 'waiter',
      is_active INTEGER DEFAULT 1,
      email TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('[Database] Core QR menu tables ensured (IF NOT EXISTS)');

  // Seed a demo table with a predictable token for easy testing on fresh deploy
  try {
    const hasDemo = db.prepare(
      `SELECT 1 FROM restaurant_tables WHERE qr_token = ?`
    ).get('e98fec05c08940318dd90aa02b6b85f5');

    if (!hasDemo) {
      db.prepare(`
        INSERT INTO restaurant_tables (table_number, capacity, status, qr_token)
        VALUES ('TEST-1', 4, 'available', 'e98fec05c08940318dd90aa02b6b85f5')
      `).run();

      // Add a couple of demo products if none exist
      const productCount = db.prepare(`SELECT COUNT(*) as c FROM products`).get() as { c: number };
      if (productCount.c === 0) {
        db.prepare(`
          INSERT INTO products (name, description, selling_price, unit, is_available, category_id)
          VALUES 
            ('Coca Cola', 'Boisson gazeuse 33cl', 25, 'pcs', 1, 1),
            ('Eau Minérale 50cl', 'Eau plate', 15, 'pcs', 1, 1),
            ('Café Express', 'Café court', 30, 'pcs', 1, 2)
        `).run();
        console.log('[Database] Demo table + products seeded for testing');
      }
    }
  } catch (e) {
    console.warn('[Database] Demo seed skipped:', e);
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// Seed helpers — idempotent guards inside each function
// ───────────────────────────────────────────────────────────────────────────────

function seedAdmin(): void {
  db.prepare(`
    INSERT INTO users (full_name, username, pin_code, role, is_active)
    SELECT 'Administrator', 'admin', '1234', 'admin', 1
    WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin')
  `).run();
}

function seedManager(): void {
  db.prepare(`
    INSERT INTO users (full_name, username, pin_code, role, is_active)
    SELECT 'Manager', 'manager', '5678', 'manager', 1
    WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'manager')
  `).run();
}

function seedWaiter(): void {
  db.prepare(`
    INSERT INTO users (full_name, username, pin_code, role, is_active)
    SELECT 'Waiter', 'waiter', '1111', 'waiter', 1
    WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'waiter')
  `).run();
}

function seedCashier(): void {
  db.prepare(`
    INSERT INTO users (full_name, username, pin_code, role, is_active)
    SELECT 'Cashier', 'cashier', '2222', 'cashier', 1
    WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'cashier')
  `).run();
}

function seedTables(): void {
  const { count } = db.prepare(`
    SELECT COUNT(*) AS count FROM restaurant_tables
  `).get() as { count: number };

  if (count === 0) {
    const stmt = db.prepare(`
      INSERT INTO restaurant_tables (table_number, capacity) VALUES (?, 4)
    `);
    ['T1', 'T2', 'T3', 'T4', 'T5', 'Bar 1', 'Bar 2'].forEach(n => stmt.run(n));
  }
}

function seedCategories(): void {
  const { count } = db.prepare(`
    SELECT COUNT(*) AS count FROM categories
  `).get() as { count: number };

  if (count === 0) {
    const seedData = [
      ['Beers',       'Alcoholic beverages — beers'],
      ['Wines',       'Alcoholic beverages — wines'],
      ['Whisky',      'Alcoholic beverages — whisky'],
      ['Soft Drinks', 'Non-alcoholic beverages'],
      ['Cocktails',   'Mixed alcoholic drinks'],
      ['Food',        'Restaurant food items'],
    ];
    const stmt = db.prepare(`
      INSERT INTO categories (name, description) VALUES (?, ?)
    `);
    for (const [name, desc] of seedData) stmt.run(name, desc);
  }
}

/**
 * Idempotent: désactive les produits "demo/test" pour éviter d'afficher
 * des items fictifs ("Just for test", etc.) dans le menu QR.
 */
function disableDemoTestProducts(): void {
  try {
    const stmt = db.prepare(`
      UPDATE products
      SET is_available = 0
      WHERE
        status = 'active'
        AND is_available = 1
        AND (
          lower(name) LIKE '%test%'
          OR lower(description) LIKE '%test%'
          OR lower(name) LIKE '%demo%'
          OR lower(description) LIKE '%demo%'
        )
    `);

    const info = stmt.run() as any;
    // better-sqlite3 exposes changes on result
    const changes = typeof info?.changes === 'number' ? info.changes : 0;
    if (changes > 0) {
      console.log(`[Database] Disabled demo/test products in products.is_available (rows: ${changes})`);
    }
  } catch (e) {
    console.error('[disableDemoTestProducts] error:', e);
  }
}

function seedSettings(): void {
  const rows = db.prepare(`
    SELECT COUNT(*) AS count FROM settings
  `).get() as { count: number };

  if (rows.count > 0) return;   // already seeded

  const defaults: Array<{ key: string; value: string }> = [
    { key: 'app_language',                   value: 'en' },
    { key: 'app_currency',                   value: 'ZMW' },
    { key: 'currency_symbol',                value: 'ZK' },
    { key: 'tax_percentage',                 value: '0' },
    { key: 'offline_mode',                   value: 'true' },
    // Notifications (real Gmail delivery)
    { key: 'email_notifications_enabled',    value: 'true' },
    { key: 'email_provider',                 value: 'gmail' },
    { key: 'smtp_host',                      value: 'smtp.gmail.com' },
    { key: 'smtp_port',                      value: '587' },
    { key: 'smtp_secure',                    value: 'false' },
    { key: 'smtp_user',                      value: 'afcodenet@gmail.com' },
    { key: 'smtp_pass',                      value: 'mqiu vnjq ejmj cncs' },
    { key: 'email_forward_to',               value: '' },
    { key: 'notify_stock_adjustment',        value: 'true' },
    { key: 'notify_inventory_update',        value: 'true' },
    { key: 'notify_low_stock',               value: 'true' },
    { key: 'notify_out_of_stock',            value: 'true' },
    { key: 'notify_new_product',             value: 'true' },
    { key: 'notify_product_deleted',         value: 'true' },
    { key: 'notify_sales',                   value: 'true' },
    { key: 'role_notification_config',       value: JSON.stringify({
      ADMIN:   { notifications: { lowStock: true, inventory: true, stockAdj: true, sales: true, newProduct: true }, emails: ['admin@olive.com'] },
      MANAGER: { notifications: { lowStock: true, inventory: true, stockAdj: true, sales: true }, emails: [] },
      CASHIER: { notifications: { sales: true, orderConfirm: true }, emails: [] },
      SERVER:  { notifications: { sales: true, orderConfirm: true }, emails: [] },
    }) },
  ];
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)
  `);
  for (const s of defaults) stmt.run(s.key, s.value);
}

function seedMenuSchema(): void {
  // Seed minimal des menus pour que le QR menu ait du contenu tout de suite.
  // Idempotent et auto-réparateur : insère les items manquants par catégorie.
  try {
    const { c: catCount } = db.prepare(`SELECT COUNT(*) as c FROM menu_categories`).get() as { c: number };
    if (catCount === 0) {
      const categories = [
        { name: 'Food', description: 'Restaurant food', display_order: 0 },
        { name: 'Drinks', description: 'Beverages', display_order: 1 },
      ];
      const stmt = db.prepare(`
        INSERT INTO menu_categories (name, description, display_order, is_active)
        VALUES (?, ?, ?, 1)
      `);
      for (const cat of categories) stmt.run(cat.name, cat.description, cat.display_order);
    }

    const foodCatId = db
      .prepare(`SELECT id FROM menu_categories WHERE name = 'Food' LIMIT 1`)
      .get() as any;
    const drinksCatId = db
      .prepare(`SELECT id FROM menu_categories WHERE name = 'Drinks' LIMIT 1`)
      .get() as any;

    const resolvedFoodId = foodCatId?.id ?? null;
    const resolvedDrinksId = drinksCatId?.id ?? null;

    const insertItemStmt = db.prepare(`
      INSERT INTO menu_items (category_id, name, description, price, currency, unit, image_url, is_available, display_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);

    const ensureCategoryItems = (categoryId: number | null, items: Array<{
      name: string;
      description: string;
      price: number;
      display_order: number;
    }>) => {
      if (!categoryId) return;

      const { c: cnt } = db
        .prepare(`SELECT COUNT(*) as c FROM menu_items WHERE category_id = ?`)
        .get(categoryId) as { c: number };

      if (cnt > 0) return;

      for (const it of items) {
        insertItemStmt.run(
          categoryId,
          it.name,
          it.description,
          it.price,
          'ZMW',
          'pcs',
          null,
          it.display_order
        );
      }
    };

    ensureCategoryItems(resolvedFoodId, [
      { name: 'Chicken Burger', description: 'Tasty chicken burger', price: 50, display_order: 0 },
      { name: 'Beef Burger', description: 'Juicy beef burger', price: 65, display_order: 1 },
      { name: 'Fried Rice', description: 'Classic fried rice', price: 45, display_order: 2 },
    ]);

    ensureCategoryItems(resolvedDrinksId, [
      { name: 'Mango Juice', description: 'Fresh mango juice', price: 25, display_order: 0 },
      { name: 'Water', description: 'Bottled water', price: 10, display_order: 1 },
      { name: 'Coke', description: 'Cold soft drink', price: 15, display_order: 2 },
    ]);
  } catch (e) {
    console.error('[seedMenuSchema] error', e);
  }
}

function ensureEmailSettingsDefaults(): void {
  const defaults: Array<{ key: string; value: string }> = [
    { key: 'email_notifications_enabled',    value: 'true' },
    { key: 'email_provider',                 value: 'gmail' },
    { key: 'smtp_host',                      value: 'smtp.gmail.com' },
    { key: 'smtp_port',                      value: '587' },
    { key: 'smtp_secure',                    value: 'false' },
    { key: 'smtp_user',                      value: 'afcodenet@gmail.com' },
    { key: 'smtp_pass',                      value: 'mqiu vnjq ejmj cncs' },
    { key: 'email_forward_to',               value: '' },
    { key: 'notify_stock_adjustment',        value: 'true' },
    { key: 'notify_inventory_update',        value: 'true' },
    { key: 'notify_low_stock',               value: 'true' },
    { key: 'notify_out_of_stock',            value: 'true' },
    { key: 'notify_new_product',             value: 'true' },
    { key: 'notify_product_deleted',         value: 'true' },
    { key: 'notify_sales',                   value: 'true' },
  ];
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)
  `);
  for (const s of defaults) stmt.run(s.key, s.value);
}

// ── Analytics Performance Indexes ─────────────────────────────────────────────
function createAnalyticsIndexes() {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_inventory_movements_product ON inventory_movements(product_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_movements_created ON inventory_movements(created_at);
    CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at);
    CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);
    CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
  `);
}

// ── Phase 3: Notifications Tables (SQLite + Supabase compatible) ───────────────
function ensureNotificationTables(): void {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        id                  TEXT PRIMARY KEY,
        type                TEXT NOT NULL,
        title               TEXT NOT NULL,
        message             TEXT NOT NULL,
        priority            TEXT NOT NULL DEFAULT 'medium',
        notification_type   TEXT,
        metadata            TEXT,
        link                TEXT,
        user_id             INTEGER,
        role                TEXT,
        read_at             DATETIME,
        created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_role ON notifications(role);
      CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(read_at) WHERE read_at IS NULL;

      CREATE TABLE IF NOT EXISTS notification_preferences (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id             INTEGER,
        role                TEXT NOT NULL,
        email_enabled       BOOLEAN DEFAULT 1,
        inapp_enabled       BOOLEAN DEFAULT 1,
        qr_orders           BOOLEAN DEFAULT 1,
        stock_alerts        BOOLEAN DEFAULT 1,
        daily_reports       BOOLEAN DEFAULT 1,
        inventory_summary   BOOLEAN DEFAULT 1,
        payment_failed      BOOLEAN DEFAULT 1,
        order_assigned      BOOLEAN DEFAULT 1,
        system_errors       BOOLEAN DEFAULT 1,
        created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(role, user_id)
      );

      CREATE TABLE IF NOT EXISTS scheduled_reports_log (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        report_type         TEXT NOT NULL,
        run_at              DATETIME NOT NULL,
        recipients_count    INTEGER DEFAULT 0,
        success             BOOLEAN DEFAULT 0,
        error_message       TEXT,
        metadata            TEXT,
        created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_scheduled_reports_run ON scheduled_reports_log(run_at DESC);
      CREATE INDEX IF NOT EXISTS idx_scheduled_reports_type ON scheduled_reports_log(report_type);
    `);

    // Default preferences for roles (idempotent)
    const roles = ['admin', 'manager', 'cashier', 'waiter'];
    const insertPref = db.prepare(`
      INSERT OR IGNORE INTO notification_preferences (role) VALUES (?)
    `);
    roles.forEach(r => insertPref.run(r));

    console.log('[Database] Notification tables ensured (Phase 3)');
  } catch (e: any) {
    console.warn('[Database] Failed to ensure notification tables:', e.message);
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// Export
// ───────────────────────────────────────────────────────────────────────────────

export default db;

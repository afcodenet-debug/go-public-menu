-- ============================================================================
-- Phase 3: Notifications & Scheduled Reports Tables
-- Compatible with SQLite (local POS) and Supabase Postgres (cloud)
-- ============================================================================

-- 1. In-app + cross-channel notifications
CREATE TABLE IF NOT EXISTS notifications (
  id                  TEXT PRIMARY KEY,
  type                TEXT NOT NULL,                    -- e.g. 'newQrOrder', 'stockLow', 'orderAssigned'...
  title               TEXT NOT NULL,
  message             TEXT NOT NULL,
  priority            TEXT NOT NULL DEFAULT 'medium',   -- low | medium | high | critical
  notification_type   TEXT,                             -- optional category (NEW_QR_ORDER, STOCK_LOW...)
  metadata            TEXT,                             -- JSON string (flexible)
  link                TEXT,                             -- deep link e.g. '/orders?highlight=123'
  user_id             INTEGER,                          -- target user (optional for role-based)
  role                TEXT,                             -- target role (admin, manager, cashier, waiter)
  read_at             DATETIME,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_role ON notifications(role);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(read_at) WHERE read_at IS NULL;

-- 2. User / Role notification preferences
CREATE TABLE IF NOT EXISTS notification_preferences (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER,                          -- NULL = default for role
  role                TEXT NOT NULL,                    -- admin | manager | cashier | waiter
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

-- 3. Audit log for scheduled reports (who received what when)
CREATE TABLE IF NOT EXISTS scheduled_reports_log (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  report_type         TEXT NOT NULL,                    -- morning_inventory | midday_ops | eod_closure
  run_at              DATETIME NOT NULL,
  recipients_count    INTEGER DEFAULT 0,
  success             BOOLEAN DEFAULT 0,
  error_message       TEXT,
  metadata            TEXT,                             -- JSON
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_scheduled_reports_run ON scheduled_reports_log(run_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduled_reports_type ON scheduled_reports_log(report_type);

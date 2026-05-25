import express from 'express';
import cors from 'cors';
import menuRoutes from './routes/menu';
import tablesRoutes from './routes/tables';
import productsRoutes from './routes/products';
import ordersRoutes from './routes/orders';
import expensesRoutes from './routes/expenses';
import dashboardRoutes from './routes/dashboard';
import categoriesRoutes from './routes/categories';
import usersRoutes from './routes/users';
import salesRoutes from './routes/sales';
import suppliersRoutes from './routes/suppliers';
import purchaseOrdersRoutes from './routes/purchase-orders';
import stockAdjustmentsRoutes from './routes/stock-adjustments';
import inventoryRoutes from './routes/inventory';
import reportsRoutes from './routes/reports';
import authRoutes from './routes/auth';
import settingsRoutes from './routes/settings';
import logsRoutes from './routes/logs';
import { startSupabasePullWorker, getPullSyncStatus } from './services/supabase-pull-sync.service';
import { env } from './config/env';

const app = express();

const PORT = process.env.PORT || 3001;

app.use(express.json());

// =============================================
// FORENSIC REQUEST LOGGING (before everything)
// =============================================
app.use((req, res, next) => {
  console.log('[HTTP]', req.method, req.originalUrl, 'origin=', req.headers.origin || 'none');
  next();
});

// =============================================
// EXPRESS CORS HARDENING - BEFORE ALL ROUTES
// Temporarily allow '*' for debugging the QR Menu
// =============================================
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-user-role');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  next();
});

// --- Render boot diagnostics (safe, low impact) ---
app.get('/test', (_req, res) => {
  res.status(200).json({ ok: true, ts: new Date().toISOString() });
});

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true, ts: new Date().toISOString() });
});

// Operational pull sync status (QR orders Supabase → local SQLite)
app.get('/api/sync/status', (_req, res) => {
  try {
    const s = getPullSyncStatus();
    res.json({
      worker: {
        running: s.workerRunning,
        enabled: s.enabled,
        intervalMs: s.pullIntervalMs,
      },
      lastPullAt: s.lastPullAt,
      lastSuccessfulPullAt: s.lastSuccessfulPullAt,
      lastCursor: s.lastCursor,
      counters: {
        ordersPulled: s.ordersPulled,
        ordersInserted: s.ordersInserted,
        ordersUpdated: s.ordersUpdated,
        itemsPulled: s.itemsPulled,
      },
      lastError: s.lastError,
      errors: s.errors,
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

console.log('[RENDER START] booting express server...');
console.log('[RENDER START] PORT=', PORT);

app.use('/api/menu', menuRoutes);
app.use('/menu', menuRoutes);   // clean public URLs for QR codes (e.g. /menu/table/<token>)

// Core API used by the admin/staff frontend (POS, Tables, Orders, Dashboard, Expenses)
app.use('/api/tables', tablesRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/expenses', expensesRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/suppliers', suppliersRoutes);
app.use('/api/purchase-orders', purchaseOrdersRoutes);
app.use('/api/stock-adjustments', stockAdjustmentsRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/logs', logsRoutes);

app.listen(PORT, () => {
  console.log(`[RENDER BOOT] Express listening on port ${PORT}`);

  if (env.RENDER_CLOUD_MODE) {
    console.log('══════════════════════════════════════════════════════════════');
    console.log('[RENDER_CLOUD_MODE] ACTIVE — Pure Supabase backend only');
    console.log('[RENDER_CLOUD_MODE] Local SQLite is FORBIDDEN on this instance');
    console.log('[RENDER_CLOUD_MODE] All data must come from Supabase (tables + products + categories)');
    console.log('══════════════════════════════════════════════════════════════');
  }

  console.log(
    `Supabase mode → PRODUCTS=${env.USE_SUPABASE_PRODUCTS}, TABLES=${env.USE_SUPABASE_TABLES}, RENDER_CLOUD_MODE=${env.RENDER_CLOUD_MODE}`
  );
  console.log('[RENDER BOOT] endpoints mounted: /health, /test, /api/auth, /api/menu, /api/tables, /api/products, /api/categories, /api/orders, /api/sales, /api/expenses, /api/dashboard, /api/users, /api/settings, /api/logs, /api/inventory, /api/reports, /api/suppliers, /api/purchase-orders, /api/stock-adjustments');

  // Lightweight Supabase → SQLite pull worker (QR orders visibility)
  // Enabled via ENABLE_SUPABASE_PULL=true (recommended on local POS machines)
  startSupabasePullWorker();
});

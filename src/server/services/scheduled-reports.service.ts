/**
 * Scheduled Reports Service
 *
 * Professional daily/periodic email reports using node-cron.
 * Designed to run on the local POS machine (has access to SQLite source of truth).
 *
 * Jobs:
 *  - 07:30 → Morning Inventory Summary
 *  - 12:30 → Midday Operations Snapshot
 *  - 23:59 → End of Day Closure Report
 *
 * All jobs respect:
 *  - email_notifications_enabled
 *  - role_notification_config (only roles that have the corresponding flag enabled receive the report)
 */

// node-cron is optional (for scheduled email reports).
// If not installed, the scheduler will simply not start (graceful degradation).
let cron: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  cron = require('node-cron');
} catch {
  // Package not installed — feature disabled
}
import { db } from '../db/database';
import {
  broadcastNotification,
  loadRawSettings,
  getDefaultEmailSettings,
  readEmailSettings,
} from './notification.service';
import { NOTIFICATION_TYPES } from '../../constants/notificationTypes';

let schedulerRunning = false;

interface ReportJob {
  name: string;
  cronExpression: string;
  handler: () => Promise<void>;
}

export function startScheduledReports() {
  if (schedulerRunning) {
    console.log('[ScheduledReports] Scheduler already running');
    return;
  }

  if (!db) {
    console.warn('[ScheduledReports] SQLite not available — scheduled reports disabled');
    return;
  }

  if (!cron) {
    console.warn('[ScheduledReports] node-cron not installed — scheduled email reports are disabled.');
    console.warn('Run: npm install node-cron @types/node-cron  (optional feature)');
    return;
  }

  const jobs: ReportJob[] = [
    {
      name: 'Morning Inventory Summary',
      cronExpression: '30 7 * * *', // 07:30 every day
      handler: sendMorningInventorySummary,
    },
    {
      name: 'Midday Operations Summary',
      cronExpression: '30 12 * * *', // 12:30 every day
      handler: sendMiddayOperationsSummary,
    },
    {
      name: 'End Of Day Closure Report',
      cronExpression: '59 23 * * *', // 23:59 every day
      handler: sendEndOfDayClosureReport,
    },
  ];

  jobs.forEach((job) => {
    cron.schedule(
      job.cronExpression,
      async () => {
        console.log(`[ScheduledReports] Running: ${job.name}`);
        try {
          await job.handler();
        } catch (err: any) {
          console.error(`[ScheduledReports] Job "${job.name}" failed:`, err.message);
        }
      },
      {
        scheduled: true,
        timezone: 'Africa/Lusaka', // Adjust to your restaurant timezone if needed
      }
    );
    console.log(`[ScheduledReports] Scheduled: ${job.name} @ ${job.cronExpression}`);
  });

  schedulerRunning = true;
  console.log('[ScheduledReports] All scheduled reports initialized');
}

/* ══════════════════════════════════════════════════════════════════════════
 * REPORT IMPLEMENTATIONS
 * ══════════════════════════════════════════════════════════════════════════ */

async function sendMorningInventorySummary() {
  const settings = loadRawSettings();
  const emailSettings = readEmailSettings(settings);

  if (!emailSettings.emailNotificationsEnabled) return;

  // Fetch low stock + out of stock
  const lowStock = db
    .prepare(
      `SELECT name, stock_quantity, minimum_stock 
       FROM products 
       WHERE stock_quantity <= minimum_stock 
       ORDER BY (stock_quantity * 1.0 / NULLIF(minimum_stock, 0)) ASC 
       LIMIT 15`
    )
    .all();

  const outOfStock = db
    .prepare(`SELECT name FROM products WHERE stock_quantity = 0 LIMIT 10`)
    .all();

  // Top selling yesterday (from sales or orders — adjust table if needed)
  const topYesterday = db
    .prepare(
      `SELECT p.name, SUM(oi.quantity) as qty
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       JOIN orders o ON o.id = oi.order_id
       WHERE date(o.created_at) = date('now', '-1 day')
       GROUP BY p.id
       ORDER BY qty DESC
       LIMIT 5`
    )
    .all();

  const html = buildInventorySummaryHTML(lowStock, outOfStock, topYesterday);

  await broadcastNotification(
    'inventory_summary',
    'Morning Inventory Summary — Great Olive',
    html,
    settings
  );
}

async function sendMiddayOperationsSummary() {
  const settings = loadRawSettings();
  const emailSettings = readEmailSettings(settings);

  if (!emailSettings.emailNotificationsEnabled) return;

  const today = new Date().toISOString().split('T')[0];

  const salesToday = db
    .prepare(
      `SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as revenue 
       FROM sales 
       WHERE date(created_at) = ?`
    )
    .get(today);

  const pendingQr = db
    .prepare(`SELECT COUNT(*) as count FROM orders WHERE status = 'pending'`)
    .get();

  const activeTables = db
    .prepare(`SELECT COUNT(*) as count FROM restaurant_tables WHERE status = 'occupied'`)
    .get();

  const criticalStock = db
    .prepare(
      `SELECT COUNT(*) as count FROM products WHERE stock_quantity <= minimum_stock`
    )
    .get();

  const html = buildMiddayHTML(salesToday, pendingQr, activeTables, criticalStock);

  await broadcastNotification(
    'midday_ops',
    'Midday Operations Snapshot — Great Olive',
    html,
    settings
  );
}

async function sendEndOfDayClosureReport() {
  const settings = loadRawSettings();
  const emailSettings = readEmailSettings(settings);

  if (!emailSettings.emailNotificationsEnabled) return;

  const today = new Date().toISOString().split('T')[0];

  const revenue = db
    .prepare(
      `SELECT 
         COUNT(*) as transactions,
         COALESCE(SUM(total), 0) as total,
         COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total ELSE 0 END), 0) as cash,
         COALESCE(SUM(CASE WHEN payment_method = 'card' THEN total ELSE 0 END), 0) as card,
         COALESCE(SUM(CASE WHEN payment_method = 'mobile_money' THEN total ELSE 0 END), 0) as mobile
       FROM sales 
       WHERE date(created_at) = ?`
    )
    .get(today);

  const expenses = db
    .prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE date(created_at) = ?`)
    .get(today);

  const topProducts = db
    .prepare(
      `SELECT p.name, SUM(oi.quantity) as qty, SUM(oi.quantity * oi.unit_price) as revenue
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       JOIN orders o ON o.id = oi.order_id
       WHERE date(o.created_at) = ?
       GROUP BY p.id ORDER BY revenue DESC LIMIT 8`
    )
    .all(today);

  const html = buildEodHTML(revenue, expenses, topProducts);

  await broadcastNotification(
    'eod_closure',
    'End of Day Closure Report — Great Olive',
    html,
    settings
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * HTML TEMPLATES (simple but professional)
 * ══════════════════════════════════════════════════════════════════════════ */

function buildInventorySummaryHTML(lowStock: any[], outOfStock: any[], top: any[]) {
  return `
    <h2>Morning Inventory Summary</h2>
    <p><strong>Low Stock Items:</strong> ${lowStock.length}</p>
    <ul>
      ${lowStock.map((p) => `<li>${p.name} — ${p.stock_quantity}/${p.minimum_stock}</li>`).join('')}
    </ul>
    <p><strong>Out of Stock:</strong> ${outOfStock.length}</p>
    <p><strong>Top Sellers Yesterday:</strong></p>
    <ul>
      ${top.map((p) => `<li>${p.name} — ${p.qty} units</li>`).join('')}
    </ul>
  `;
}

function buildMiddayHTML(sales: any, qr: any, tables: any, critical: any) {
  return `
    <h2>Midday Operations Snapshot</h2>
    <p>Sales today: <strong>${sales.count}</strong> transactions — <strong>${sales.revenue}</strong></p>
    <p>Pending QR orders: <strong>${qr.count}</strong></p>
    <p>Occupied tables: <strong>${tables.count}</strong></p>
    <p>Critical stock items: <strong>${critical.count}</strong></p>
  `;
}

function buildEodHTML(revenue: any, expenses: any, top: any[]) {
  return `
    <h2>End of Day Closure Report</h2>
    <p>Total Revenue: <strong>${revenue.total}</strong> (${revenue.transactions} tx)</p>
    <p>Cash: ${revenue.cash} | Card: ${revenue.card} | Mobile: ${revenue.mobile}</p>
    <p>Expenses: <strong>${expenses.total}</strong></p>
    <p>Top Products:</p>
    <ul>
      ${top.map((p: any) => `<li>${p.name} — ${p.qty} units (${p.revenue})</li>`).join('')}
    </ul>
  `;
}

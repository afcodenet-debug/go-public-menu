import express from 'express';
import db from '../db/database';

const router = express.Router();

/**
 * GET /api/dashboard/summary
 * Professional single-call dashboard data for the main overview screen.
 *
 * Returns:
 * - kpis: revenueToday, revenueYesterday, transactionsToday, activeTables, openOrders, lowStockItems, staffOnDuty
 * - hourlySales: real sales per hour for today
 * - recentActivity: last sales + recent orders + low stock events
 * - topProducts: best sellers today
 */
router.get('/summary', (req, res) => {
  // Cloud mode guard: SQLite may be disabled (db === null)
  if (!db) {
    console.warn('[Dashboard] SQLite disabled (db is null). Returning empty dashboard summary');
    return res.status(200).json({
      kpis: {
        revenueToday: 0,
        revenueYesterday: 0,
        transactionsToday: 0,
        activeTables: 0,
        openOrders: 0,
        lowStockItems: 0,
        staffOnDuty: 0
      },
      hourlySales: Array.from({ length: 24 }, (_, h) => {
        const hh = h.toString().padStart(2, '0');
        return { hour: `${hh}h`, amount: 0 };
      }),
      recentActivity: [],
      topProducts: [],
      lastUpdated: new Date().toISOString()
    });
  }

  try {
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    // 1. KPIs
    const revenueRow = db.prepare(`
      SELECT COALESCE(SUM(total_amount), 0) as revenue, COUNT(*) as tx_count
      FROM sales
      WHERE DATE(created_at) = ?
    `).get(today) as { revenue: number; tx_count: number };

    const yesterdayRow = db.prepare(`
      SELECT COALESCE(SUM(total_amount), 0) as revenue
      FROM sales
      WHERE DATE(created_at) = ?
    `).get(yesterday) as { revenue: number };

    const activeTablesRow = db.prepare(`
      SELECT COUNT(DISTINCT table_id) as active
      FROM orders
      WHERE status NOT IN ('paid', 'cancelled') AND table_id IS NOT NULL
    `).get() as { active: number };

    const openOrdersRow = db.prepare(`
      SELECT COUNT(*) as count
      FROM orders
      WHERE status NOT IN ('paid', 'cancelled')
    `).get() as { count: number };

    const lowStockRow = db.prepare(`
      SELECT COUNT(*) as count
      FROM products
      WHERE is_available = 1 AND stock_quantity <= minimum_stock
    `).get() as { count: number };

    const staffRow = db.prepare(`
      SELECT COUNT(*) as count
      FROM users
      WHERE is_active = 1
    `).get() as { count: number };

    // 2. Real hourly sales for today (00-23)
    const hourlyRows = db.prepare(`
      SELECT
        strftime('%H', created_at) as hour,
        COALESCE(SUM(total_amount), 0) as amount
      FROM sales
      WHERE DATE(created_at) = ?
      GROUP BY strftime('%H', created_at)
      ORDER BY hour
    `).all(today) as Array<{ hour: string; amount: number }>;

    // Fill missing hours with 0
    const hourlySales = Array.from({ length: 24 }, (_, h) => {
      const hh = h.toString().padStart(2, '0');
      const found = hourlyRows.find(r => r.hour === hh);
      return {
        hour: `${hh}h`,
        amount: found ? Number(found.amount) : 0
      };
    });

    // 3. Recent Activity (last 8 meaningful events)
    const recentSales = db.prepare(`
      SELECT
        s.id,
        s.total_amount,
        s.payment_method,
        s.created_at,
        u.full_name as cashier_name,
        t.table_number
      FROM sales s
      LEFT JOIN users u ON s.user_id = u.id
      LEFT JOIN orders o ON s.order_id = o.id
      LEFT JOIN restaurant_tables t ON o.table_id = t.id
      ORDER BY s.created_at DESC
      LIMIT 5
    `).all() as any[];

    const recentOrders = db.prepare(`
      SELECT
        o.id,
        o.table_id,
        o.status,
        o.created_at,
        t.table_number,
        u.full_name as waiter_name
      FROM orders o
      LEFT JOIN restaurant_tables t ON o.table_id = t.id
      LEFT JOIN users u ON o.waiter_id = u.id
      WHERE o.status NOT IN ('paid', 'cancelled')
      ORDER BY o.created_at DESC
      LIMIT 3
    `).all() as any[];

    const lowStockItems = db.prepare(`
      SELECT id, name, stock_quantity, minimum_stock
      FROM products
      WHERE stock_quantity <= minimum_stock AND is_available = 1
      ORDER BY (stock_quantity - minimum_stock) ASC
      LIMIT 3
    `).all() as any[];

    const recentActivity: any[] = [];

    // Sales as activity
    recentSales.forEach(s => {
      recentActivity.push({
        type: 'sale',
        id: s.id,
        amount: s.total_amount,
        table: s.table_number || null,
        method: s.payment_method,
        actor: s.cashier_name || 'Staff',
        time: s.created_at
      });
    });

    // Open orders as activity
    recentOrders.forEach(o => {
      recentActivity.push({
        type: 'order',
        id: o.id,
        table: o.table_number,
        status: o.status,
        actor: o.waiter_name || 'Waiter',
        time: o.created_at
      });
    });

    // Low stock as activity
    lowStockItems.forEach(p => {
      recentActivity.push({
        type: 'stock',
        id: p.id,
        product: p.name,
        current: p.stock_quantity,
        minimum: p.minimum_stock,
        time: new Date().toISOString() // approximate
      });
    });

    // Sort by time desc and take latest 8
    recentActivity.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

    // 4. Top products today (from sale_items joined with today's sales)
    const topProducts = db.prepare(`
      SELECT
        p.name as product_name,
        SUM(si.quantity) as qty,
        SUM(si.total_price) as revenue
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      JOIN products p ON si.product_id = p.id
      WHERE DATE(s.created_at) = ?
      GROUP BY p.id
      ORDER BY revenue DESC
      LIMIT 5
    `).all(today) as any[];

    res.json({
      kpis: {
        revenueToday: Number(revenueRow.revenue || 0),
        revenueYesterday: Number(yesterdayRow.revenue || 0),
        transactionsToday: Number(revenueRow.tx_count || 0),
        activeTables: Number(activeTablesRow.active || 0),
        openOrders: Number(openOrdersRow.count || 0),
        lowStockItems: Number(lowStockRow.count || 0),
        staffOnDuty: Number(staffRow.count || 0)
      },
      hourlySales,
      recentActivity: recentActivity.slice(0, 8),
      topProducts: topProducts.map(p => ({
        name: p.product_name,
        qty: Number(p.qty),
        revenue: Number(p.revenue)
      })),
      lastUpdated: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('[Dashboard] summary error:', error);
    return res.status(200).json({
      kpis: {
        revenueToday: 0,
        revenueYesterday: 0,
        transactionsToday: 0,
        activeTables: 0,
        openOrders: 0,
        lowStockItems: 0,
        staffOnDuty: 0
      },
      hourlySales: Array.from({ length: 24 }, (_, h) => {
        const hh = h.toString().padStart(2, '0');
        return { hour: `${hh}h`, amount: 0 };
      }),
      recentActivity: [],
      topProducts: [],
      lastUpdated: new Date().toISOString()
    });
  }
});

export default router;

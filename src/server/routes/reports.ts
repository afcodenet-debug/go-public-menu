import express from 'express';
import db from '../db/database';

const router = express.Router();

// GET /api/reports/daily-sales?date=YYYY-MM-DD
router.get('/daily-sales', (req, res) => {
  if (!db) {
    console.warn('[Reports] SQLite disabled (db is null). Returning [] for daily-sales');
    return res.json([]);
  }
  let dateParam: string | undefined;
  try {
    const { date } = req.query;
    dateParam = date as string | undefined;
    const query = dateParam
      ? "SELECT DATE(created_at) as date, SUM(total_amount) as total_amount, COUNT(*) as transaction_count FROM sales WHERE DATE(created_at) = ? GROUP BY DATE(created_at)"
      : "SELECT DATE(created_at) as date, SUM(total_amount) as total_amount, COUNT(*) as transaction_count FROM sales GROUP BY DATE(created_at) ORDER BY date DESC LIMIT 30";

    if (dateParam) {
      const rows = db.prepare(query).all(dateParam) as any[];
      res.json(rows);
    } else {
      const rows = db.prepare(query).all() as any[];
      res.json(rows);
    }
  } catch (error: any) {
    const sqliteErr = error?.code || error?.errno || 'unknown';
    console.error('[REPORTS API FORENSIC ERROR] /daily-sales', {
      message: error?.message,
      sqliteCode: sqliteErr,
      stack: error?.stack,
      query: dateParam ? 'SELECT DATE... WHERE DATE(created_at) = ?' : 'SELECT DATE... GROUP BY... LIMIT 30',
      params: dateParam ? [dateParam] : [],
      dbNull: !db
    });
    res.status(500).json({ error: 'Failed to fetch daily sales' });
  }
});

// GET /api/reports/weekly-sales?start=YYYY-MM-DD&end=YYYY-MM-DD
router.get('/weekly-sales', (req, res) => {
  if (!db) {
    console.warn('[Reports] SQLite disabled (db is null). Returning [] for weekly-sales');
    return res.json([]);
  }
  try {
    const { start, end } = req.query;
    let query = `
      SELECT DATE(created_at) as date, SUM(total_amount) as total_amount, COUNT(*) as transaction_count
      FROM sales
      WHERE 1=1
    `;
    const params: any[] = [];

    if (start) {
      query += ` AND DATE(created_at) >= ?`;
      params.push(start);
    }
    if (end) {
      query += ` AND DATE(created_at) <= ?`;
      params.push(end);
    }
    query += ` GROUP BY DATE(created_at) ORDER BY date DESC`;

    const rows = db.prepare(query).all(...params) as any[];
    res.json(rows);
  } catch (error) {
    console.error('[Reports] weekly-sales error:', error);
    res.status(500).json({ error: 'Failed to fetch weekly sales' });
  }
});

// GET /api/reports/monthly-sales?month=MM&year=YYYY
router.get('/monthly-sales', (req, res) => {
  if (!db) {
    console.warn('[Reports] SQLite disabled (db is null). Returning [] for monthly-sales');
    return res.json([]);
  }
  try {
    const month = req.query.month ? String(req.query.month) : null;
    const year = req.query.year ? String(req.query.year) : null;
    let query = `
      SELECT strftime('%Y-%m', created_at) as date, SUM(total_amount) as total_amount, COUNT(*) as transaction_count
      FROM sales
      WHERE 1=1
    `;
    const params: any[] = [];

    if (month) {
      query += ` AND strftime('%m', created_at) = ?`;
      params.push(month.padStart(2, '0'));
    }
    if (year) {
      query += ` AND strftime('%Y', created_at) = ?`;
      params.push(year);
    }
    query += ` GROUP BY strftime('%Y-%m', created_at) ORDER BY date DESC`;

    const rows = db.prepare(query).all(...params) as any[];
    res.json(rows);
  } catch (error) {
    console.error('[Reports] monthly-sales error:', error);
    res.status(500).json({ error: 'Failed to fetch monthly sales' });
  }
});

// GET /api/reports/top-products?limit=10
router.get('/top-products', (req, res) => {
  if (!db) {
    console.warn('[Reports] SQLite disabled (db is null). Returning [] for top-products');
    return res.json([]);
  }
  try {
    const { limit = 10 } = req.query;
    const query = `
      SELECT p.id as product_id, p.name as product_name, SUM(si.quantity) as quantity_sold, SUM(si.total_price) as revenue
      FROM sale_items si
      JOIN products p ON si.product_id = p.id
      GROUP BY si.product_id
      ORDER BY revenue DESC
      LIMIT ?
    `;
    const rows = db.prepare(query).all(Number(limit)) as any[];
    res.json(rows);
  } catch (error) {
    console.error('[Reports] top-products error:', error);
    res.status(500).json({ error: 'Failed to fetch top products' });
  }
});

// GET /api/reports/low-stock
router.get('/low-stock', (req, res) => {
  if (!db) {
    console.warn('[Reports] SQLite disabled (db is null). Returning [] for low-stock');
    return res.json([]);
  }
  try {
    const query = `
      SELECT id, name, stock_quantity, minimum_stock
      FROM products
      WHERE stock_quantity <= minimum_stock AND is_available = 1
      ORDER BY stock_quantity ASC
    `;
    const rows = db.prepare(query).all() as any[];
    res.json(rows);
  } catch (error) {
    console.error('[Reports] low-stock error:', error);
    res.status(500).json({ error: 'Failed to fetch low stock' });
  }
});

// GET /api/reports/payment-methods - revenue breakdown by payment method
router.get('/payment-methods', (req, res) => {
  if (!db) {
    console.warn('[Reports] SQLite disabled (db is null). Returning [] for payment-methods');
    return res.json([]);
  }
  try {
    const { start, end } = req.query;
    let query = `
      SELECT payment_method, SUM(total_amount) as total, COUNT(*) as count
      FROM sales
      WHERE 1=1
    `;
    const params: any[] = [];
    if (start) { query += ` AND DATE(created_at) >= ?`; params.push(start); }
    if (end) { query += ` AND DATE(created_at) <= ?`; params.push(end); }
    query += ` GROUP BY payment_method ORDER BY total DESC`;
    const rows = db.prepare(query).all(...params) as any[];
    res.json(rows);
  } catch (error) {
    console.error('[Reports] payment-methods error:', error);
    res.status(500).json({ error: 'Failed to fetch payment methods' });
  }
});

// GET /api/reports/categories-performance - revenue by category
router.get('/categories-performance', (req, res) => {
  if (!db) {
    console.warn('[Reports] SQLite disabled (db is null). Returning [] for categories-performance');
    return res.json([]);
  }
  try {
    const { start, end } = req.query;
    let query = `
      SELECT c.name as category_name, SUM(si.total_price) as revenue, COUNT(*) as items_sold
      FROM sale_items si
      JOIN products p ON si.product_id = p.id
      JOIN categories c ON p.category_id = c.id
      LEFT JOIN sales s ON si.sale_id = s.id
      WHERE 1=1
    `;
    const params: any[] = [];
    if (start) { query += ` AND DATE(s.created_at) >= ?`; params.push(start); }
    if (end) { query += ` AND DATE(s.created_at) <= ?`; params.push(end); }
    query += ` GROUP BY c.id, c.name ORDER BY revenue DESC`;
    const rows = db.prepare(query).all(...params) as any[];
    res.json(rows);
  } catch (error) {
    console.error('[Reports] categories-performance error:', error);
    res.status(500).json({ error: 'Failed to fetch categories performance' });
  }
});

// GET /api/reports/inventory-movements - stock movements history
router.get('/inventory-movements', (req, res) => {
  if (!db) {
    console.warn('[Reports] SQLite disabled (db is null). Returning [] for inventory-movements');
    return res.json([]);
  }
  try {
    const { start, end, product_id, limit = 100 } = req.query;
    let query = `
      SELECT im.*, p.name as product_name
      FROM inventory_movements im
      LEFT JOIN products p ON im.product_id = p.id
      WHERE 1=1
    `;
    const params: any[] = [];
    if (start) { query += ` AND DATE(im.created_at) >= ?`; params.push(start); }
    if (end) { query += ` AND DATE(im.created_at) <= ?`; params.push(end); }
    if (product_id) { query += ` AND im.product_id = ?`; params.push(product_id); }
    query += ` ORDER BY im.created_at DESC LIMIT ?`;
    params.push(Number(limit));
    const rows = db.prepare(query).all(...params) as any[];
    res.json(rows);
  } catch (error) {
    console.error('[Reports] inventory-movements error:', error);
    res.status(500).json({ error: 'Failed to fetch inventory movements' });
  }
});

// GET /api/reports/summary - aggregated business metrics
router.get('/summary', (req, res) => {
  if (!db) {
    return res.status(200).json({
      totalRevenue: 0,
      totalTransactions: 0,
      avgTicket: 0,
      topProduct: null,
      lowStockCount: 0
    });
  }
  try {
    const { start, end } = req.query;
    const startParam = start ? String(start) : undefined;
    const endParam = end ? String(end) : undefined;

    let salesDateFilter = '';
    const salesParams: any[] = [];
    if (startParam && endParam) {
      salesDateFilter = ' WHERE DATE(created_at) BETWEEN ? AND ?';
      salesParams.push(startParam, endParam);
    } else if (startParam) {
      salesDateFilter = ' WHERE DATE(created_at) >= ?';
      salesParams.push(startParam);
    } else if (endParam) {
      salesDateFilter = ' WHERE DATE(created_at) <= ?';
      salesParams.push(endParam);
    }

    const totalRow = db.prepare(`
      SELECT SUM(total_amount) as total, COUNT(*) as count
      FROM sales${salesDateFilter}
    `).get(...salesParams) as { total: number; count: number };

    let topDateFilter = '';
    const topParams: any[] = [];
    if (startParam && endParam) {
      topDateFilter = ' WHERE DATE(s.created_at) BETWEEN ? AND ?';
      topParams.push(startParam, endParam);
    } else if (startParam) {
      topDateFilter = ' WHERE DATE(s.created_at) >= ?';
      topParams.push(startParam);
    } else if (endParam) {
      topDateFilter = ' WHERE DATE(s.created_at) <= ?';
      topParams.push(endParam);
    }

    const topProductRow = db.prepare(`
      SELECT p.name as product_name, SUM(si.quantity) as quantity_sold, SUM(si.total_price) as revenue
      FROM sale_items si
      JOIN products p ON si.product_id = p.id
      JOIN sales s ON si.sale_id = s.id${topDateFilter}
      GROUP BY p.id, p.name
      ORDER BY revenue DESC
      LIMIT 1
    `).all(...topParams) as any[];

    const lowStockCount = db.prepare(`
      SELECT COUNT(*) as count FROM products WHERE stock_quantity <= minimum_stock AND is_available = 1
    `).get() as { count: number };

    res.json({
      totalRevenue: Number(totalRow?.total || 0),
      totalTransactions: Number(totalRow?.count || 0),
      avgTicket: totalRow?.count > 0 ? Number(totalRow.total) / totalRow.count : 0,
      topProduct: topProductRow[0] || null,
      lowStockCount: Number(lowStockCount?.count || 0)
    });
  } catch (error) {
    console.error('[Reports] summary error:', error);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

export default router;
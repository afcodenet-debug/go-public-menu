import express from 'express';
import db from '../db/database';
import { OrderService } from '../services/order.service';
import { requirePermission } from '../middleware/auth';
import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env';
// import { syncService } from '../sync';

const router = express.Router();

/* Get active orders (with RBAC filtering) */
router.get('/active', async (req, res) => {
  const { waiter_id, role } = req.query;

  // Cloud mode guard: db might be null (SQLite disabled).
  if (!db) {
    console.warn('[Orders] SQLite disabled (db is null). Returning [] for GET /orders/active');
    return res.status(200).json([]);
  }

  try {
    const params: any = {};
    if (waiter_id) params.waiter_id = Number(waiter_id);
    if (role) params.role = role as string;

    const orders = await OrderService.getAll(params);
    res.json(orders);
  } catch (error: any) {
    console.error('[Orders] Real error in GET /orders:', error);
    console.error(error.stack);
    res.status(500).json({ 
      error: 'Failed to fetch orders',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined 
    });
  }
});

// Get all orders with filters (for management view)
router.get('/', (req, res) => {
  // Cloud mode guard: db might be null (SQLite disabled).
  if (!db) {
    console.warn('[Orders] SQLite disabled (db is null). Returning empty payload for GET /orders');
    return res.status(200).json({ orders: [], stats: {
      active_orders: 0,
      preparing_orders: 0,
      ready_orders: 0,
      served_orders: 0,
      paid_orders: 0,
      revenue_today: 0
    }, pagination: { limit: 50, offset: 0, hasMore: false } });
  }
  const { waiter_id, role, status, payment_status, table_id, search, limit = 50, offset = 0 } = req.query;

  try {
    console.log('[Orders] GET / called with params:', { waiter_id, role, status, limit, offset });

    let query = `
      SELECT
        o.id, o.table_id, o.waiter_id, o.status, o.total, o.created_at,
        o.remote_id, o.source,
        t.table_number,
        u.full_name as waiter_name,
        NULL as customer_phone,
        NULL as customer_name,
        CASE
          WHEN o.status IN ('paid', 'cancelled') THEN 'completed'
          ELSE 'pending'
        END as payment_status
      FROM orders o
      LEFT JOIN restaurant_tables t ON o.table_id = t.id
      LEFT JOIN users u ON o.waiter_id = u.id
      WHERE 1=1
    `;

    const params: any[] = [];

    // RBAC filtering (legacy; authorization must be header-based)
    if (role === 'waiter' && waiter_id) {
      query += ` AND o.waiter_id = ?`;
      params.push(waiter_id);
    }

    // Basic filters
    if (status) {
      query += ` AND o.status = ?`;
      params.push(status);
    }

    if (table_id) {
      query += ` AND o.table_id = ?`;
      params.push(table_id);
    }

    if (search) {
      query += ` AND (o.id LIKE ? OR t.table_number LIKE ? OR u.full_name LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ` ORDER BY o.created_at DESC LIMIT ? OFFSET ?`;
    params.push(Number(limit), Number(offset));

    const orders = db.prepare(query).all(...params);

    // Simple stats
    const stats = {
      active_orders: 0,
      preparing_orders: 0,
      ready_orders: 0,
      served_orders: 0,
      paid_orders: 0,
      revenue_today: 0
    };

    // Count stats with proper filtering (legacy)
    let statsQuery = `
      SELECT status, total, created_at
      FROM orders o
      WHERE 1=1
    `;
    const statsParams: any[] = [];

    if (role === 'waiter' && waiter_id) {
      statsQuery += ` AND o.waiter_id = ?`;
      statsParams.push(waiter_id);
    }

    const allOrders = db.prepare(statsQuery).all(...statsParams);

    allOrders.forEach((o: any) => {
      try {
        if (o.status !== 'paid' && o.status !== 'cancelled') stats.active_orders++;
        if (o.status === 'preparing') stats.preparing_orders++;
        if (o.status === 'ready') stats.ready_orders++;
        if (o.status === 'served') stats.served_orders++;
        if (o.status === 'paid') {
          stats.paid_orders++;
          const createdDate = o.created_at ? new Date(o.created_at) : null;
          if (createdDate && createdDate.toDateString() === new Date().toDateString()) {
            stats.revenue_today += Number(o.total) || 0;
          }
        }
      } catch (e) {
        console.warn('[Orders] Error processing stats for order', o?.id, e);
      }
    });

    const response = {
      orders: orders || [],
      stats: stats,
      pagination: {
        limit: Number(limit),
        offset: Number(offset),
        hasMore: (orders || []).length === Number(limit)
      }
    };
    res.json(response);
  } catch (error: any) {
    console.error('=== ORDERS FETCH ERROR ===');
    console.error('Error message:', error?.message);
    console.error('Error code:', error?.code);
    console.error('Full error:', error);
    console.error(error?.stack);
    res.status(500).json({ 
      error: 'Failed to fetch orders',
      details: process.env.NODE_ENV === 'development' ? (error?.message || error?.toString()) : undefined 
    });
  }
});

// Create new order (Support for Table and Takeaway)
router.post('/', requirePermission('CREATE_ORDERS'), async (req, res) => {
  const { table_id, waiter_id, items, total, status = 'pending' } = req.body;

  // console.log('[Orders] POST payload:', {
  //   table_id,
  //   waiter_id,
  //   status,
  //   total,
  //   item0: Array.isArray(items) ? items[0] : items,
  //   item0Keys: Array.isArray(items) && items[0] ? Object.keys(items[0]) : []
  // });

  if (!waiter_id) {
    return res.status(400).json({ error: 'Waiter ID is required' });
  }

  try {
    const orderData = {
      table_id: table_id && table_id !== 0 ? Number(table_id) : null,
      waiter_id: Number(waiter_id),
      items: Array.isArray(items) ? items : JSON.parse(items || '[]'),
      total: Number(total) || 0,
      status: status as any
    };

    const order = await OrderService.create(orderData);
    res.json(order);
  } catch (error: any) {
    console.error('[Orders] POST error:', error?.message);
    console.error(error?.stack);
    res.status(400).json({ 
      error: error?.message,
      details: error?.toString?.() ?? undefined
    });
  }
});

// Update order items
router.patch('/:id/items', requirePermission('UPDATE_ORDER_STATUS'), async (req, res) => {
  const { id } = req.params;
  const { items } = req.body;

  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'Items must be an array' });
  }

  try {
    const updatedOrder = await OrderService.updateItems(Number(id), items);
    res.json(updatedOrder);
  } catch (error: any) {
    console.error('[Orders] PATCH items error:', error);
    res.status(500).json({ error: error.message || 'Failed to update items' });
  }
});

// Get order by ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const orderId = Number(id);

  try {
    // Cloud / Supabase mode: fetch directly from Supabase (orders created by public QR menu live here)
    const isCloud = !db || env.USE_SUPABASE_TABLES;
    if (isCloud) {
      if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
        return res.status(500).json({ error: 'Supabase not configured for order lookup' });
      }

      const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      });

      const { data: supaOrder, error: supaErr } = await supabase
        .from('orders')
        .select('id, status, total, items, created_at, updated_at, table_id, waiter_id, customer_id')
        .eq('id', orderId)
        .single();

      if (supaErr || !supaOrder) {
        return res.status(404).json({ error: 'Order not found' });
      }

      // Normalize for the public polling client (only needs status + total + items array)
      const normalized = {
        id: supaOrder.id,
        status: supaOrder.status || 'pending',
        total: Number(supaOrder.total || 0),
        items: Array.isArray(supaOrder.items) ? supaOrder.items : [],
        created_at: supaOrder.created_at,
      };

      return res.json(normalized);
    }

    // Legacy SQLite path (POS)
    const order = await OrderService.getById(orderId);
    if (order) {
      res.json(order);
    } else {
      res.status(404).json({ error: 'Order not found' });
    }
  } catch (error: any) {
    console.error('=== ORDERS GET /:id ERROR ===');
    console.error('Error message:', error?.message);
    console.error('Error code:', error?.code);
    console.error('Full error:', error);
    console.error(error?.stack);
    res.status(500).json({ 
      error: 'Failed to fetch order',
      details: process.env.NODE_ENV === 'development' ? (error?.message || error?.toString()) : undefined 
    });
  }
});

// Update order status
router.patch('/:id/status', requirePermission('UPDATE_ORDER_STATUS'), async (req, res) => {
  const { status } = req.body;
  const { id } = req.params;

  try {
    const updatedOrder = await OrderService.updateStatus(Number(id), status);
    res.json(updatedOrder);
  } catch (error: any) {
    console.error('[Orders] PATCH status error:', error);
    res.status(500).json({ error: error.message || 'Failed to update status' });
  }
});

// Hard delete order (for rejecting unconfirmed QR orders)
router.delete('/:id', requirePermission('UPDATE_ORDER_STATUS'), async (req, res) => {
  const { id } = req.params;

  try {
    await OrderService.deleteOrder(Number(id));
    res.json({ success: true, deleted: Number(id) });
  } catch (error: any) {
    console.error('[Orders] DELETE error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete order' });
  }
});

export default router;

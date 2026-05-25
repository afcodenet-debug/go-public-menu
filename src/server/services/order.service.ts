import db from '../db/database';
import { notifyOrderCheckout, loadRawSettings } from '../services/notification.service';
import { createClient } from '@supabase/supabase-js';

export interface OrderItem {
  productId: number;
  name: string;
  price: number;
  quantity: number;
  notes?: string | null;
}

export interface OrderData {
  id?: number;
  table_id: number | null;
  waiter_id: number;
   status: 'pending' | 'confirmed' | 'preparing' | 'ready' | 'served' | 'paid' | 'cancelled' | 'rejected';
  items: OrderItem[];
  total: number;
  discount?: number;
  tax?: number;
  customer_name?: string;
  customer_phone?: string;
  customer_id?: number | null;
  created_at?: string;
  updated_at?: string;
}

export class OrderService {
  private static getItemsForOrder(orderId: number, fallbackJson?: string, isRemote: boolean = false): OrderItem[] {
    try {
      // For remote QR orders (pulled from Supabase), the pulled JSON snapshot is the source of truth.
      // The public menu only sends {product_id, quantity, name} — we enrich with current local price.
      if (isRemote && fallbackJson) {
        const rawItems = JSON.parse(fallbackJson || '[]') as any[];
        return rawItems.map((it: any) => {
          const prod = db.prepare('SELECT selling_price FROM products WHERE id = ?').get(it.product_id || it.productId) as any;
          const price = Number(prod?.selling_price ?? it.price ?? it.unit_price ?? 0);
          return {
            productId: it.product_id || it.productId,
            name: it.name || '',
            price,
            quantity: Number(it.quantity) || 0,
            notes: it.notes ?? undefined
          };
        });
      }

      const items = db.prepare(`
        SELECT
          oi.product_id AS productId,
          p.name,
          oi.unit_price AS price,
          oi.quantity,
          oi.notes
        FROM order_items oi
        LEFT JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = ?
      `).all(orderId) as any[];

      if (items.length > 0) {
        return items.map(item => ({
          productId: item.productId,
          name: item.name || '',
          price: item.price,
          quantity: item.quantity,
          notes: item.notes ?? undefined
        }));
      }

      if (fallbackJson) {
        return JSON.parse(fallbackJson || '[]') as OrderItem[];
      }

      const order = db.prepare('SELECT items FROM orders WHERE id = ?').get(orderId) as any;
      return order ? JSON.parse(order.items || '[]') : [];
    } catch (error) {
      console.error('[OrderService] Error fetching order items:', error);
      return [];
    }
  }

  private static insertOrderItems(orderId: number, items: OrderItem[]): void {
    const itemStmt = db.prepare(`
      INSERT INTO order_items (
        order_id, product_id, quantity, unit_price, total_price, notes
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const item of items as any[]) {
      const productId = item.productId ?? item.product_id;

      itemStmt.run(
        orderId,
        productId,
        Number(item.quantity),
        Number(item.price),
        Number(item.price) * Number(item.quantity),
        item.notes ?? null
      );
    }
  }

  private static replaceOrderItems(orderId: number, items: OrderItem[]): void {
    db.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);
    this.insertOrderItems(orderId, items);
  }

  /**
   * Get all orders with filtering
   */
  static async getAll(params: {
    waiter_id?: number;
    role?: string;
    table_id?: number;
    status?: string;
  } = {}): Promise<OrderData[]> {
    const { waiter_id, role, table_id, status } = params;

    let query = `
      SELECT
        o.*,
        t.table_number,
        u.full_name as waiter_name,
        u.role as waiter_role
      FROM orders o
      LEFT JOIN restaurant_tables t ON o.table_id = t.id
      LEFT JOIN users u ON o.waiter_id = u.id
      WHERE 1=1
    `;
    const queryParams: any[] = [];

    // RBAC filtering
    if (role === 'waiter' && waiter_id) {
      query += ` AND o.waiter_id = ?`;
      queryParams.push(waiter_id);
    }

    if (table_id) {
      query += ` AND o.table_id = ?`;
      queryParams.push(table_id);
    }

    if (status) {
      query += ` AND o.status = ?`;
      queryParams.push(status);
    }

    query += ` ORDER BY o.created_at DESC`;

    try {
      const orders = db.prepare(query).all(...queryParams) as any[];
      return orders.map(order => ({
        ...order,
        items: this.getItemsForOrder(order.id, order.items, !!order.remote_id)
      }));
    } catch (error: any) {
      console.error('[OrderService] Error fetching orders (real error):', error);
      console.error(error.stack);
      throw new Error('Failed to fetch orders: ' + (error.message || 'unknown'));
    }
  }

  /**
   * Get order by ID
   */
  static async getById(id: number): Promise<OrderData | null> {
    try {
      const order = db.prepare(`
        SELECT
          o.*,
          t.table_number,
          u.full_name as waiter_name
        FROM orders o
        LEFT JOIN restaurant_tables t ON o.table_id = t.id
        LEFT JOIN users u ON o.waiter_id = u.id
        WHERE o.id = ?
      `).get(id) as any;

      if (order) {
        return {
          ...order,
          items: this.getItemsForOrder(order.id, order.items, !!order.remote_id)
        };
      }
      return null;
    } catch (error) {
      console.error('[OrderService] Error fetching order:', error);
      throw new Error('Failed to fetch order');
    }
  }

  /**
   * Create new order with item merging logic
   */
  static async create(orderData: Omit<OrderData, 'id' | 'created_at' | 'updated_at'>): Promise<OrderData> {
    const transaction = db.transaction(() => {
      try {
        const { table_id, waiter_id, items, status } = orderData;

        const normalizedItems = items.map((item: any) => ({
          ...item,
          // Support payload snake_case from frontend: product_id
          productId: item.productId ?? item.product_id,
          name: item.name || '',
          quantity: Number(item.quantity),
          price: Number(item.price),
          notes: item.notes ?? null
        }));

        const total = normalizedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

        // If table order, check for existing active order
        if (table_id) {
          const existingOrder = db.prepare(`
            SELECT id, items FROM orders
            WHERE table_id = ? AND status NOT IN ('paid', 'cancelled')
            ORDER BY created_at DESC LIMIT 1
          `).get(table_id) as any;

          if (existingOrder) {
            console.log(`[OrderService] Merging items into existing order ${existingOrder.id}`);
            const existingItems = this.getItemsForOrder(existingOrder.id, existingOrder.items);
            const itemMap = new Map<number, OrderItem>();

            existingItems.forEach((item: OrderItem) => itemMap.set(item.productId, { ...item }));
            normalizedItems.forEach((newItem: OrderItem) => {
              const existing = itemMap.get(newItem.productId);
              if (existing) {
                existing.quantity += newItem.quantity;
              } else {
                itemMap.set(newItem.productId, { ...newItem });
              }
            });

            const mergedItems = Array.from(itemMap.values());
            const mergedTotal = mergedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

            db.prepare(`
              UPDATE orders
              SET items = ?, total = ?, updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `).run(JSON.stringify(mergedItems), mergedTotal, existingOrder.id);

            this.replaceOrderItems(existingOrder.id, mergedItems);

            const updatedOrder = db.prepare(`
              SELECT
                o.*,
                t.table_number,
                u.full_name as waiter_name
              FROM orders o
              LEFT JOIN restaurant_tables t ON o.table_id = t.id
              LEFT JOIN users u ON o.waiter_id = u.id
              WHERE o.id = ?
            `).get(existingOrder.id) as any;

            return {
              ...updatedOrder,
              items: mergedItems
            };
          }
        }

        console.log('[OrderService] Creating order WITHOUT customer_id column');
        const result = db.prepare(`
          INSERT INTO orders (table_id, waiter_id, items, status, total, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(
          table_id,
          waiter_id,
          JSON.stringify(normalizedItems),
          status || 'pending',
          total
        );

        const orderId = Number(result.lastInsertRowid);
        this.insertOrderItems(orderId, normalizedItems);

        const newOrder = db.prepare(`
          SELECT
            o.*,
            t.table_number,
            u.full_name as waiter_name
          FROM orders o
          LEFT JOIN restaurant_tables t ON o.table_id = t.id
          LEFT JOIN users u ON o.waiter_id = u.id
          WHERE o.id = ?
        `).get(orderId) as any;

        return {
          ...newOrder,
          items: this.getItemsForOrder(orderId, JSON.stringify(normalizedItems))
        };
      } catch (error) {
        throw error;
      }
    });

    try {
      return transaction();
    } catch (error: any) {
      console.error('[OrderService] Error creating order:', error);
      throw new Error(error.message || 'Failed to create order');
    }
  }

  /**
   * Update order items
   */
  static async updateItems(id: number, items: OrderItem[]): Promise<OrderData> {
    const transaction = db.transaction(() => {
      try {
        const existingOrder = db.prepare('SELECT id FROM orders WHERE id = ?').get(id);
        if (!existingOrder) {
          throw new Error('Order not found');
        }

        const normalizedItems = items.map(item => ({
          ...item,
          name: item.name || '',
          quantity: Number(item.quantity),
          price: Number(item.price),
          notes: item.notes ?? null
        }));

        const total = normalizedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

        db.prepare(`
          UPDATE orders
          SET items = ?, total = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(JSON.stringify(normalizedItems), total, id);

        this.replaceOrderItems(id, normalizedItems);

        const updatedOrder = db.prepare(`
          SELECT
            o.*,
            t.table_number,
            u.full_name as waiter_name
          FROM orders o
          LEFT JOIN restaurant_tables t ON o.table_id = t.id
          LEFT JOIN users u ON o.waiter_id = u.id
          WHERE o.id = ?
        `).get(id) as any;

        return {
          ...updatedOrder,
          items: normalizedItems
        };
      } catch (error) {
        throw error;
      }
    });

    try {
      return transaction();
    } catch (error: any) {
      console.error('[OrderService] Error updating order items:', error);
      throw new Error(error.message || 'Failed to update order items');
    }
  }

  /**
   * Update order status
   */
  static async updateStatus(id: number, status: OrderData['status']): Promise<OrderData> {
    const transaction = db.transaction(() => {
      try {
        const wasPaid = (db.prepare('SELECT status FROM orders WHERE id = ?').get(id) as any)?.status === 'paid';
        
        if (status === 'paid') {
          const order = db.prepare('SELECT table_id FROM orders WHERE id = ?').get(id) as any;
          if (order && order.table_id) {
            db.prepare("UPDATE restaurant_tables SET status = 'cleaning' WHERE id = ?").run(order.table_id);
          }
        } else if (status === 'cancelled') {
          const order = db.prepare('SELECT table_id FROM orders WHERE id = ?').get(id) as any;
          if (order && order.table_id) {
            const activeOrders = db.prepare(`
              SELECT COUNT(*) as count FROM orders
              WHERE table_id = ? AND status NOT IN ('paid', 'cancelled')
            `).get(order.table_id) as any;
            if (activeOrders.count === 0) {
              db.prepare("UPDATE restaurant_tables SET status = 'available' WHERE id = ?").run(order.table_id);
            }
          }
        }

        db.prepare('UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, id);

        const updatedOrder = db.prepare(`
          SELECT
            o.*,
            t.table_number,
            u.full_name as waiter_name
          FROM orders o
          LEFT JOIN restaurant_tables t ON o.table_id = t.id
          LEFT JOIN users u ON o.waiter_id = u.id
          WHERE o.id = ?
        `).get(id) as any;

        // === Push status update back to Supabase for remote QR orders ===
        // This allows the customer (on the public QR menu) to see the order evolution
        // (pending → confirmed → preparing → ready → served, etc.)
        // === Push status back to Supabase for remote QR orders ===
        if (updatedOrder && updatedOrder.remote_id) {
          const remoteId = updatedOrder.remote_id;
          console.log(`[Sync] Attempting to push status "${status}" for local order #${id} (remote_id=${remoteId})`);

          setImmediate(async () => {
            try {
              const supabaseUrl = process.env.SUPABASE_URL;
              const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

              if (!supabaseUrl || !supabaseKey) {
                console.error('[Sync] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — cannot push status');
                return;
              }

              const supabase = createClient(supabaseUrl, supabaseKey, {
                auth: { persistSession: false }
              });

              const { error, data } = await supabase
                .from('orders')
                .update({ 
                  status, 
                  updated_at: new Date().toISOString() 
                })
                .eq('id', remoteId)
                .select();

              if (error) {
                console.error(`[Sync] FAILED to push status to Supabase for remote_id=${remoteId}:`, error.message);
              } else {
                console.log(`[Sync] ✓ SUCCESS — Pushed status "${status}" to Supabase for remote_id=${remoteId}`, data);
              }
            } catch (e: any) {
              console.error(`[Sync] Exception while pushing status for remote_id=${remoteId}:`, e?.message || e);
            }
          });
        } else {
          console.log(`[Sync] Order #${id} has no remote_id — skipping Supabase push (local order only)`);
        }

        const result = {
          ...updatedOrder,
          items: this.getItemsForOrder(id, updatedOrder.items)
        };

        if (!wasPaid && status === 'paid') {
          const saleExists = db.prepare('SELECT 1 FROM sales WHERE order_id = ? LIMIT 1').get(id);
          if (saleExists) {
            console.log('[OrderService] Order already has sale record, skipping duplicate checkout notification.');
          } else {
            setImmediate(async () => {
              try {
                const rawSettings = loadRawSettings();
                const orderItems = result.items.map((item: any) => ({
                  name: item.name,
                  qty: item.quantity,
                  unitPrice: item.price,
                  total: item.price * item.quantity,
                }));
                const tableLabel = result.table_id
                  ? `Table ${result.table_number || result.table_id}`
                  : 'Counter';
                await notifyOrderCheckout(
                  id,
                  orderItems,
                  result.total,
                  'cash',
                  tableLabel,
                  result.waiter_name,
                  undefined,
                  'USD',
                  rawSettings,
                );
              } catch (err) {
                console.error('[OrderService] Failed to send checkout notification:', err);
              }
            });
          }
        }

        return result;
      } catch (error) {
        throw error;
      }
    });

    try {
      return transaction();
    } catch (error: any) {
      console.error('[OrderService] Error updating order status:', error);
      throw new Error(error.message || 'Failed to update order status');
    }
  }

  /**
   * Validate order operations
   */
  static validateOrderOperation(order: OrderData, operation: string): void {
    switch (operation) {
      case 'checkout':
        if (order.status === 'paid') {
          throw new Error('Order is already paid');
        }
        if (order.status === 'cancelled') {
          throw new Error('Cannot checkout cancelled order');
        }
        break;

      case 'update':
        if (order.status === 'paid') {
          throw new Error('Cannot update paid order');
        }
        if (order.status === 'cancelled') {
          throw new Error('Cannot update cancelled order');
        }
        break;

      default:
        break;
    }
  }

  /**
   * Hard delete order + its items (used for rejecting pending QR orders)
   */
  static async deleteOrder(id: number): Promise<void> {
    const transaction = db.transaction(() => {
      try {
        // delete items first (FK safety)
        db.prepare('DELETE FROM order_items WHERE order_id = ?').run(id);
        const result = db.prepare('DELETE FROM orders WHERE id = ?').run(id);
        if (result.changes === 0) {
          throw new Error('Order not found');
        }
      } catch (error) {
        throw error;
      }
    });

    try {
      transaction();
    } catch (error: any) {
      console.error('[OrderService] Error deleting order:', error);
      throw new Error(error.message || 'Failed to delete order');
    }
  }
}
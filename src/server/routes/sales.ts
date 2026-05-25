import express from 'express';
import db from '../db/database';
import { notifyOrderCheckout } from '../services/notification.service';
import { requirePermission } from '../middleware/auth';

const router = express.Router();

// Get all sales for reports and history
router.get('/', (req, res) => {
  try {
    const sales = db.prepare(`
      SELECT s.*, u.full_name as user_name 
      FROM sales s
      LEFT JOIN users u ON s.user_id = u.id
      ORDER BY s.created_at DESC
    `).all();
    res.json(sales);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch sales' });
  }
});

// Checkout logic: Convert Order to Sale
router.post('/checkout', requirePermission('PROCESS_PAYMENTS'), (req, res) => {
  const { order_id, payment_method: rawPaymentMethod, user_id, discount = 0, tax = 0, items: requestItems } = req.body;

  // Normalize to the exact values allowed by the DB CHECK constraint
  const allowed = ['cash', 'card', 'mobile_money'] as const;
  let payment_method = (rawPaymentMethod || 'cash').toString().toLowerCase().trim();
  if (!allowed.includes(payment_method as any)) {
    payment_method = 'cash';
  }

  console.log('[Sales] Checkout request:', { order_id, payment_method, user_id, discount, tax, items: Array.isArray(requestItems) ? requestItems.length : 'none' });

  // ── Variables captured by the transaction closure ──────────────────
  let invoiceNumber = '';
  let subtotal      = 0;
  let saleId: number = 0;
  let order: Record<string, any> = {};
  let itemsForNotify: Array<{ name: string; qty: number; price: number; totalPrice: number }> = [];

  const transaction = db.transaction(() => {
    try {
      order = db.prepare('SELECT * FROM orders WHERE id = ?').get(order_id) as any;
      console.log('[Sales] Found order:', order);
      if (!order) throw new Error('Order not found');
      if (order.status === 'paid') throw new Error('Order already finalized');

      const isRemoteQrOrder = !!order.remote_id;   // orders pulled from Supabase via the QR pull worker

      let items: any[] = Array.isArray(requestItems) ? requestItems : [];

      if (items.length === 0) {
        if (isRemoteQrOrder) {
          // For remote QR orders, lock to the exact snapshot that was pulled from Supabase.
          // Public menu only sends {product_id, quantity, name} — normalize to what the rest of the code expects.
          const raw = JSON.parse(order.items || '[]');
          items = raw.map((it: any) => {
            const pid = it.product_id || it.productId;
            const prod = db.prepare('SELECT selling_price FROM products WHERE id = ?').get(pid) as any;
            return {
              productId: pid,
              quantity: Number(it.quantity) || 0,
              name: it.name || '',
              price: Number(it.price || it.unit_price || prod?.selling_price || 0),
              notes: it.notes || null
            };
          });
        } else {
          items = db.prepare(`
            SELECT
              oi.product_id AS productId,
              p.name AS name,
              oi.quantity,
              oi.unit_price AS price,
              oi.total_price,
              oi.notes,
              p.buying_price
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            WHERE oi.order_id = ?
          `).all(order_id) as any[];

          if (items.length === 0) {
            items = JSON.parse(order.items || '[]');
          }
        }
      }

      subtotal = items.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0);
      console.log('[Sales] Resolved order items:', items, 'subtotal:', subtotal);

      const fulfilledItems: any[] = [];
      const blockedItems: any[] = [];

      for (const item of items) {
        console.log('[Sales] Evaluating item stock:', item);
        const product = db.prepare('SELECT stock_quantity, buying_price FROM products WHERE id = ?').get(item.productId) as any;

        if (!product) throw new Error(`Product ${item.productId} not found`);

        const available = Number(product.stock_quantity ?? 0);
        const requested = Number(item.quantity);

        if (isRemoteQrOrder) {
          // For orders that came from the public QR menu, we allow the sale
          // even if local stock is insufficient (the "sale" happened on the customer side).
          fulfilledItems.push({ ...item, quantity: requested, product });
          continue;
        }

        if (available <= 0) {
          blockedItems.push({ ...item, quantity: requested });
          continue;
        }

        if (available >= requested) {
          fulfilledItems.push({ ...item, quantity: requested, product });
        } else {
          fulfilledItems.push({ ...item, quantity: available, product });
          blockedItems.push({ ...item, quantity: requested - available, notes: item.notes ?? null });
        }
      }

      const fulfilledSubtotal = fulfilledItems.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0);

      if (fulfilledSubtotal <= 0 && !isRemoteQrOrder) {
        const blockedNames = blockedItems.map(item => item.name).join(', ');
        throw new Error(`Insufficient stock for ${blockedNames}`);
      }

      const saleDiscount = discount && subtotal > 0 ? Math.round((fulfilledSubtotal / subtotal) * discount) : 0;
      const saleTax = tax && subtotal > 0 ? Math.round((fulfilledSubtotal / subtotal) * tax) : 0;
      const saleTotal = fulfilledSubtotal - saleDiscount + saleTax;

      itemsForNotify = fulfilledItems.map((item: any) => ({
        name: item.name,
        qty: Number(item.quantity),
        price: Number(item.price),
        totalPrice: Number(item.price) * Number(item.quantity),
      }));

      // Short invoice number (max 6 digits after INV-)
      invoiceNumber = `INV-${String(Date.now()).slice(-5)}${Math.floor(Math.random() * 10)}`;

      const saleStmt = db.prepare(`
        INSERT INTO sales (invoice_number, order_id, user_id, subtotal, discount, tax, total_amount, payment_method)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const saleResult = saleStmt.run(
        invoiceNumber,
        order_id,
        user_id,
        fulfilledSubtotal,
        saleDiscount,
        saleTax,
        saleTotal,
        payment_method
      );
      saleId = Number(saleResult.lastInsertRowid);

      const itemStmt = db.prepare(`
        INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, total_price)
        VALUES (?, ?, ?, ?, ?)
      `);

      const movementStmt = db.prepare(`
        INSERT INTO inventory_movements (
          product_id, movement_type, 
          quantity_before, quantity_changed, quantity_after,
          unit_cost, total_value,
          reason, created_by, reference_type, reference_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const item of fulfilledItems) {
        console.log('[Sales] Processing fulfilled item:', item);
        const quantityBefore = Number(item.product.stock_quantity ?? 0);
        const quantityChanged = -Number(item.quantity);
        const quantityAfter = quantityBefore + quantityChanged;
        const unitCost = Number(item.product.buying_price ?? 0);
        const totalValue = Number(item.quantity) * unitCost;

        itemStmt.run(saleId, item.productId, item.quantity, item.price, item.price * item.quantity);

        // For orders pulled from the public QR menu (remote_id present), we do NOT touch local stock.
        // The "sale" conceptually happened on the customer-facing side.
        if (!isRemoteQrOrder) {
          db.prepare('UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?').run(item.quantity, item.productId);

          try {
            movementStmt.run(
              item.productId,
              'sale',
              quantityBefore,
              quantityChanged,
              quantityAfter,
              unitCost,
              totalValue,
              `Sale ${invoiceNumber}`,
              user_id || null,
              'sale',
              saleId
            );
          } catch (movementError) {
            console.error('[Sales] Failed to record inventory movement:', movementError);
          }
        }
      }

      let remainingOrder: any = null;
      if (blockedItems.length > 0) {
        const remainingTotal = blockedItems.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0);

        db.prepare(`
          UPDATE orders
          SET items = ?, total = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(JSON.stringify(blockedItems), remainingTotal, order_id);

        db.prepare('DELETE FROM order_items WHERE order_id = ?').run(order_id);
        const orderItemStmt = db.prepare(`
          INSERT INTO order_items (order_id, product_id, quantity, unit_price, total_price, notes)
          VALUES (?, ?, ?, ?, ?, ?)
        `);

        for (const item of blockedItems) {
          orderItemStmt.run(order_id, item.productId, item.quantity, item.price, item.price * item.quantity, item.notes ?? null);
        }

        remainingOrder = {
          id: order_id,
          table_id: order.table_id,
          waiter_id: order.waiter_id,
          status: order.status,
          items: blockedItems,
          total: remainingTotal,
          discount: order.discount,
          tax: order.tax
        };
      } else {
        db.prepare("UPDATE orders SET status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(order_id);
      }

      return {
        saleId,
        invoiceNumber,
        partial: blockedItems.length > 0,
        blockedItems: blockedItems.map(item => ({ name: item.name, quantity: item.quantity })),
        soldItems: fulfilledItems.map(item => ({ name: item.name, quantity: item.quantity, price: item.price, totalPrice: item.price * item.quantity })),
        saleTotal,
        remainingOrder
      };
    } catch (error) {
      throw error;
    }
  });

  try {
    const result = transaction();
    console.log('[Sales] Checkout completed, scheduling order checkout notification for saleId=', result.saleId);

    // ── Fire-and-forget order checkout notification (non-blocking) ──
    setImmediate(async () => {
      try {
        const settingsRows = db.prepare(
          "SELECT key, value FROM settings"
        ).all() as { key: string; value: string }[];
        const rawSettings = Object.fromEntries(
          settingsRows.map(r => [r.key, r.value])
        );
        await notifyOrderCheckout(
          order_id,
          itemsForNotify.map((it: any) => ({
            name: it.name,
            qty: it.qty,
            unitPrice: it.price,
            total: it.totalPrice,
          })),
          result.saleTotal,
          payment_method,
          order.table_id
            ? `Table ${(db.prepare('SELECT table_number FROM restaurant_tables WHERE id = ?').get(order.table_id) as any)?.table_number || order.table_id}`
            : 'Counter',
          order.waiter_id
            ? (db.prepare('SELECT full_name FROM users WHERE id = ?').get(order.waiter_id) as any)?.full_name
            : undefined,
          (db.prepare('SELECT full_name FROM users WHERE id = ?').get(user_id) as any)?.full_name,
          String(rawSettings.app_currency || 'USD'),
          rawSettings,
        );
      } catch (notifyErr) {
        console.error('[Notification] order checkout email failed:', notifyErr);
      }
    });

    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Generate receipt data
router.get('/receipt/:saleId', (req, res) => {
  const { saleId } = req.params;

  try {
    const sale = db.prepare(`
      SELECT
        s.*,
        u.full_name as cashier_name,
        o.table_id,
        t.table_number,
        ow.full_name as waiter_name
      FROM sales s
      JOIN users u ON s.user_id = u.id
      LEFT JOIN orders o ON s.order_id = o.id
      LEFT JOIN restaurant_tables t ON o.table_id = t.id
      LEFT JOIN users ow ON o.waiter_id = ow.id
      WHERE s.id = ?
    `).get(saleId) as any;

    if (!sale) {
      return res.status(404).json({ error: 'Sale not found' });
    }

    const items = db.prepare(`
      SELECT si.*, p.name as product_name
      FROM sale_items si
      JOIN products p ON si.product_id = p.id
      WHERE si.sale_id = ?
    `).all(saleId);

    const receipt = {
      business: {
        name: 'GREAT OLIVE',
        address: '123 Restaurant Street, City, State 12345',
        phone: '(555) 123-4567'
      },
      invoice: {
        number: sale.invoice_number,
        date: new Date(sale.created_at).toLocaleString(),
        table: sale.table_number || 'Counter',
        waiter: sale.waiter_name || 'N/A',
        cashier: sale.cashier_name
      },
      items: items.map((item: any) => ({
        name: item.product_name,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        totalPrice: item.total_price
      })),
      totals: {
        subtotal: sale.subtotal,
        discount: sale.discount,
        tax: sale.tax,
        total: sale.total_amount
      },
      payment: {
        method: sale.payment_method,
        amount: sale.total_amount
      },
      footer: 'Thank you for dining with us!\nVisit again soon.'
    };

    res.json(receipt);
  } catch (error) {
    console.error('Receipt generation error:', error);
    res.status(500).json({ error: 'Failed to generate receipt' });
  }
});

export default router;

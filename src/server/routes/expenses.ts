import express from 'express';
import db from '../db/database';

const router = express.Router();

// Get all expenses
router.get('/', (req, res) => {
  // Cloud mode guard: SQLite may be disabled (db === null)
  if (!db) {
    console.warn('[Expenses] SQLite disabled (db is null). Returning empty list for GET /expenses');
    return res.status(200).json([]);
  }

  try {
    const expenses = db.prepare(`
      SELECT e.*, u.full_name as user_name
      FROM expenses e
      JOIN users u ON e.user_id = u.id
      ORDER BY e.created_at DESC
    `).all();
    res.json(expenses);
  } catch (error) {
    console.error('[Expenses] GET error:', error);
    res.status(500).json({ error: 'Failed to fetch expenses' });
  }
});

// Create new expense
router.post('/', (req, res) => {
  const { description, amount, category, user_id } = req.body;

  if (!description || !amount || !category || !user_id) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO expenses (description, amount, category, user_id)
      VALUES (?, ?, ?, ?)
    `).run(description, amount, category, user_id);

    res.json({ id: result.lastInsertRowid });
  } catch (error) {
    console.error('[Expenses] POST error:', error);
    res.status(500).json({ error: 'Failed to create expense' });
  }
});

// Delete expense (admin/manager only)
router.delete('/:id', (req, res) => {
  const { id } = req.params;

  try {
    const result = db.prepare('DELETE FROM expenses WHERE id = ?').run(id);

    if (result.changes > 0) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Expense not found' });
    }
  } catch (error) {
    console.error('[Expenses] DELETE error:', error);
    res.status(500).json({ error: 'Failed to delete expense' });
  }
});

export default router;
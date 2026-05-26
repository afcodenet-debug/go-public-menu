import express from 'express';
import db from '../db/database';
import { env } from '../config/env';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

// Professional Login: Checks PIN + Identity
// Supports both local SQLite (dev) and Supabase (RENDER_CLOUD_MODE / production Vercel frontend)
router.post('/login', async (req, res) => {
  const { pin_code, identity } = req.body;
  console.log(`[Auth] Login attempt received. PIN: ${pin_code}, Identity: ${identity || 'None'}`);

  const useSupabase = env.RENDER_CLOUD_MODE || !db;

  if (useSupabase && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      });

      let query = supabase
        .from('users')
        .select('id, full_name, role, is_active, username, phone')
        .eq('is_active', true)
        .eq('pin_code', pin_code);

      if (identity) {
        // Support login by username OR phone when identity is provided
        query = query.or(`username.eq.${identity},phone.eq.${identity}`);
      }

      const { data: user, error } = await query.maybeSingle();

      if (error) {
        console.error('[Auth Supabase] Query error:', error);
        throw error;
      }

      if (user) {
        console.log(`[Auth] Success (Supabase): User ${user.full_name} (${user.role}) logged in.`);
        return res.json(user);
      } else {
        console.warn(`[Auth] Failed (Supabase): No active user found for PIN ${pin_code}`);
        return res.status(401).json({ error: 'Invalid Credentials or Inactive Account' });
      }
    } catch (error: any) {
      console.error('[Auth Supabase] Critical error during login:', error?.message || error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  // --- Legacy / local SQLite path (when db is available) ---
  if (!db) {
    console.warn('[Auth] No SQLite database available and Supabase not configured for auth');
    return res.status(500).json({ error: 'Internal Server Error' });
  }

  try {
    let user: any;

    if (identity) {
      user = db.prepare(`
        SELECT id, full_name, role, is_active, username, phone
        FROM users 
        WHERE (username = ? OR phone = ?) AND pin_code = ? AND is_active = 1
      `).get(identity, identity, pin_code);
    } else {
      user = db.prepare(`
        SELECT id, full_name, role, is_active
        FROM users 
        WHERE pin_code = ? AND is_active = 1
      `).get(pin_code);
    }

    if (user) {
      console.log(`[Auth] Success: User ${user.full_name} (${user.role}) logged in.`);
      res.json(user);
    } else {
      console.warn(`[Auth] Failed: No active user found for PIN ${pin_code}`);
      res.status(401).json({ error: 'Invalid Credentials or Inactive Account' });
    }
  } catch (error) {
    console.error('[Auth] Critical database error during login:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Health check specifically for auth connectivity
router.get('/status', (req, res) => {
  res.json({ status: 'ready', database: 'connected' });
});

export default router;

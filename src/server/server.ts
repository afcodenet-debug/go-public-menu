import express from 'express';
import cors from 'cors';
import menuRoutes from './routes/menu';
import tablesRoutes from './routes/tables';
import productsRoutes from './routes/products';
import ordersRoutes from './routes/orders';
import expensesRoutes from './routes/expenses';
import dashboardRoutes from './routes/dashboard';
import { env } from './config/env';

const app = express();

const PORT = process.env.PORT || 3001;


app.use(express.json());
app.use(cors({ origin: '*' }))

process.on('uncaughtException', (err) => {
  console.error('[RENDER CRASH] uncaughtException:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[RENDER CRASH] unhandledRejection:', reason);
  process.exit(1);
});


// CORS configuration for Vercel frontend + public QR menu
const allowedOrigins = [
  'https://great-olive.vercel.app',
  'https://great-olive-git-main.vercel.app', // common Vercel preview
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:4173',
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin) || env.RENDER_CLOUD_MODE) {
      // In cloud mode we are more permissive for public menu
      callback(null, true);
    } else {
      callback(new Error(`CORS blocked: origin ${origin} not allowed`));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-user-role'],
  credentials: false, // public endpoints, no cookies needed
}));

// --- Render boot diagnostics (safe, low impact) ---
app.get('/test', (_req, res) => {
  res.status(200).json({ ok: true, ts: new Date().toISOString() });
});

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true, ts: new Date().toISOString() });
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
  console.log('[RENDER BOOT] endpoints: /health, /test, /api/menu/..., /menu/...');
});

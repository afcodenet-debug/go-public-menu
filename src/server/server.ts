import express from 'express';
import cors from 'cors';
import { initializeDatabase } from './db/database';
import path from 'path';
import fs from 'fs';
import { scheduleInventorySummaryEmails, scheduleStockMovementEmails } from './services/notification.service';
import { startSupabaseSyncScheduler, stopSupabaseSyncScheduler } from './services/supabase-sync.service';
// import { syncService } from './sync';
import inventoryRoutes from './routes/inventory';
import salesRoutes from './routes/sales';
import employeesRoutes from './routes/employees';
import tablesRoutes from './routes/tables';
import ordersRoutes from './routes/orders';
import authRoutes from './routes/auth';
import categoriesRoutes from './routes/categories';
import productsRoutes from './routes/products';
import usersRoutes from './routes/users';
import expensesRoutes from './routes/expenses';
import logsRoutes from './routes/logs';
import reportsRoutes from './routes/reports';
import settingsRoutes from './routes/settings';
import dashboardRoutes from './routes/dashboard';
import stockAdjustmentRoutes from './routes/stock-adjustments';
import supplierRoutes from './routes/suppliers';
import purchaseOrderRoutes from './routes/purchase-orders';
import menuRoutes from './routes/menu';

const app = express();
const PORT = process.env.PORT || 3001;

// CORS configurable (prod + dev)
const rawOrigins = process.env.CORS_ORIGINS || '';
const allowedOrigins = rawOrigins
  ? rawOrigins.split(',').map(o => o.trim()).filter(Boolean)
  : [
      'http://localhost:5173',
      'http://localhost:5174',
      'http://127.0.0.1:5173',
    ];

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-User-Role'],
}));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: true }));

// Initialize database (applies migrations + seeds)
try {
  initializeDatabase();
  console.log('Database initialized successfully');

  // Démarre la synchronisation périodique vers Supabase (SQLite → Supabase)
  startSupabaseSyncScheduler();
} catch (error) {
  console.error('Failed to initialize database:', error);
  process.exit(1);
}

app.use((req, _res, next) => {
  // Debug only for users endpoints to verify the request actually reaches this server build
  if (req.url.startsWith('/api/users')) {
    console.log('[SERVER] hit', req.method, req.url);
  }
  next();
});

// Routes
app.use('/api/auth',               authRoutes);
app.use('/api/categories',         categoriesRoutes);
app.use('/api/products',           productsRoutes);
app.use('/api/inventory',          inventoryRoutes);
app.use('/api/sales',              salesRoutes);
app.use('/api/users',              usersRoutes);
app.use('/api/employees',          employeesRoutes);
app.use('/api/tables',             tablesRoutes);
app.use('/api/orders',             ordersRoutes);
app.use('/api/expenses',           expensesRoutes);
app.use('/api/logs',               logsRoutes);
app.use('/api/reports',            reportsRoutes);
app.use('/api/settings',           settingsRoutes);
app.use('/api/dashboard',          dashboardRoutes);
app.use('/api/stock-adjustments',  stockAdjustmentRoutes);
app.use('/api/suppliers',          supplierRoutes);
app.use('/api/purchase-orders',    purchaseOrderRoutes);
app.use('/api/menu',              menuRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// ─── Static file serving for uploads ───────────────────────────────────────
const uploadsDir = path.resolve(process.cwd(), 'data', 'uploads');
if (fs.existsSync(uploadsDir)) {
  app.use('/api/uploads', express.static(uploadsDir, {
    maxAge: '7d',
    setHeaders: (res: express.Response, filePath: string) => {
      if (/\.(jpg|jpeg|png|gif|webp)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=604800');
      }
    }
  }));
  console.log(`[Server] Serving uploads from: ${uploadsDir}`);
}

// Error handler
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  console.log('Server started successfully');
  scheduleInventorySummaryEmails();
  scheduleStockMovementEmails();
});

// Arrêt propre du scheduler de synchronisation
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...');
  stopSupabaseSyncScheduler();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Server] Received SIGTERM. Shutting down gracefully...');
  stopSupabaseSyncScheduler();
  process.exit(0);
});

import express from 'express';
import menuRoutes from './routes/menu';
import { env } from './config/env';

const app = express();
app.use(express.json());

app.use('/api/menu', menuRoutes);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Supabase mode → PRODUCTS=${env.USE_SUPABASE_PRODUCTS}, TABLES=${env.USE_SUPABASE_TABLES}`);
});

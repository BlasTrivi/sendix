import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import authRouter from './routes/auth.js';
import protectedRouter from './routes/protected.js';

const app = express();

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.get('/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.use('/api/auth', authRouter);
app.use('/api', protectedRouter);

// Static frontend (serve SPA)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontRoot = path.resolve(__dirname, '..', '..'); // proyecto raíz /workspaces/sendix
app.use(express.static(frontRoot));
// SPA fallback except API routes
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(frontRoot, 'index.html'));
});

// Fallback de errores no capturados
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'internal error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Sendix server listening on http://localhost:${PORT}`);
});

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Sendix server listening on http://localhost:${PORT}`);
});

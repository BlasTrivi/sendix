import express from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = express.Router();

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.get('/admin-stats', requireAuth, requireRole('ADMIN'), (_req, res) => {
  res.json({ stats: { users: 'hidden', note: 'Admin only' } });
});

export default router;

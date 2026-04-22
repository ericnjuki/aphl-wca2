import { Router, Request, Response } from 'express';
import { query } from '../db/database';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  // Quick sanity check that the DB is reachable.
  const [row] = query<{ now: string }>(`SELECT datetime('now') AS now`);

  res.json({
    status: 'ok',
    timestamp: row?.now ?? new Date().toISOString(),
  });
});

export default router;

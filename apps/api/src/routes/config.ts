import { Router, Request, Response } from 'express';
import { publicConfig } from '../lib/org-labels';

// Public (no login): the web app reads it at startup, before anyone signs in.
const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json(publicConfig());
});

export default router;

import { Router, Request, Response, NextFunction } from 'express';
import { query as qv, validationResult } from 'express-validator';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { searchAddresses } from '../lib/geocode';

const router = Router();
router.use(authenticate);

router.get('/search',
  qv('q').trim().isLength({ min: 3, max: 200 }),
  async (req: Request, res: Response, next: NextFunction) => {
    if (!validationResult(req).isEmpty()) return next(new AppError('Query must be 3-200 characters', 400));
    try {
      res.json({ results: await searchAddresses(req.query.q as string) });
    } catch (err) { next(err); }
  }
);

export default router;

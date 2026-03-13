import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { body, validationResult } from 'express-validator';
import { query, queryOne } from '../db/pool';
import { redis, RedisKeys } from '../db/redis';
import { authenticate, JwtPayload } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../lib/logger';

const router = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────
function generateTokens(payload: Omit<JwtPayload, 'jti'>) {
  const jti = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accessOptions: SignOptions = {
    expiresIn: (process.env.JWT_EXPIRES_IN || '15m') as any,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const refreshOptions: SignOptions = {
    expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || '7d') as any,
  };
  const accessToken = jwt.sign(
    { ...payload, jti },
    process.env.JWT_SECRET!,
    accessOptions
  );
  const refreshToken = jwt.sign(
    { userId: payload.userId, jti: randomUUID() },
    process.env.JWT_REFRESH_SECRET!,
    refreshOptions
  );
  return { accessToken, refreshToken, jti };
}

// ─── POST /api/auth/login ────────────────────────────────────────────────────
router.post('/login',
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  async (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new AppError('Invalid email or password', 400));

    try {
      const { email, password } = req.body as { email: string; password: string };

      const user = await queryOne<{
        id: number; org_id: number; email: string; password_hash: string;
        name: string; role: 'admin' | 'dispatcher' | 'driver'; is_active: boolean;
      }>(
        'SELECT id, org_id, email, password_hash, name, role, is_active FROM users WHERE email = $1',
        [email]
      );

      if (!user || !user.is_active) {
        return next(new AppError('Invalid email or password', 401));
      }

      const passwordMatch = await bcrypt.compare(password, user.password_hash);
      if (!passwordMatch) {
        return next(new AppError('Invalid email or password', 401));
      }

      // Update last login
      await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

      const { accessToken, refreshToken } = generateTokens({
        userId: user.id,
        orgId: user.org_id,
        role: user.role,
      });

      // Store refresh token hash in Redis (7 days TTL)
      await redis.setex(
        RedisKeys.refreshToken(user.id),
        7 * 24 * 3600,
        await bcrypt.hash(refreshToken, 8)
      );

      logger.info('User logged in', { userId: user.id, role: user.role });

      res.json({
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          orgId: user.org_id,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/auth/refresh ──────────────────────────────────────────────────
router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (!refreshToken) return next(new AppError('Refresh token required', 400));

  try {
    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) as { userId: number };

    const storedHash = await redis.get(RedisKeys.refreshToken(payload.userId));
    if (!storedHash) return next(new AppError('Refresh token expired or invalid', 401));

    const valid = await bcrypt.compare(refreshToken, storedHash);
    if (!valid) return next(new AppError('Invalid refresh token', 401));

    const user = await queryOne<{
      id: number; org_id: number; role: 'admin' | 'dispatcher' | 'driver';
    }>(
      'SELECT id, org_id, role FROM users WHERE id = $1 AND is_active = true',
      [payload.userId]
    );

    if (!user) return next(new AppError('User not found', 401));

    const tokens = generateTokens({ userId: user.id, orgId: user.org_id, role: user.role });

    // Rotate refresh token
    await redis.setex(
      RedisKeys.refreshToken(user.id),
      7 * 24 * 3600,
      await bcrypt.hash(tokens.refreshToken, 8)
    );

    res.json({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
  } catch {
    next(new AppError('Invalid refresh token', 401));
  }
});

// ─── POST /api/auth/logout ───────────────────────────────────────────────────
router.post('/logout', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Blacklist the current access token JTI until it would have expired (15 min)
    await redis.setex(RedisKeys.tokenBlacklist(req.user!.jti), 15 * 60, '1');
    // Delete refresh token
    await redis.del(RedisKeys.refreshToken(req.user!.userId));
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/auth/me ────────────────────────────────────────────────────────
router.get('/me', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await queryOne<{
      id: number; email: string; name: string; role: string;
      phone: string | null; org_id: number;
    }>(
      'SELECT id, email, name, role, phone, org_id FROM users WHERE id = $1',
      [req.user!.userId]
    );

    if (!user) return next(new AppError('User not found', 404));
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/change-password ─────────────────────────────────────────
router.post('/change-password',
  authenticate,
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 8 }),
  async (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new AppError('Password must be at least 8 characters', 400));

    try {
      const { currentPassword, newPassword } = req.body as {
        currentPassword: string; newPassword: string;
      };

      const user = await queryOne<{ password_hash: string }>(
        'SELECT password_hash FROM users WHERE id = $1',
        [req.user!.userId]
      );

      if (!user) return next(new AppError('User not found', 404));

      const match = await bcrypt.compare(currentPassword, user.password_hash);
      if (!match) return next(new AppError('Current password is incorrect', 400));

      const newHash = await bcrypt.hash(newPassword, 12);
      await query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [
        newHash, req.user!.userId,
      ]);

      res.json({ message: 'Password changed successfully' });
    } catch (err) {
      next(err);
    }
  }
);

export default router;

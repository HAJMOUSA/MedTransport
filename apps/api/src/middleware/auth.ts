import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { redis, RedisKeys } from '../db/redis';
import { AppError } from './errorHandler';

export interface JwtPayload {
  userId: number;
  orgId: number;
  role: 'admin' | 'dispatcher' | 'driver';
  jti: string; // JWT ID for blacklisting
}

// Extend Express Request to include authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next(new AppError('No authorization token provided', 401));
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;

    // Check if token has been blacklisted (logout)
    redis.get(RedisKeys.tokenBlacklist(payload.jti)).then((blacklisted) => {
      if (blacklisted) return next(new AppError('Token has been revoked', 401));
      req.user = payload;
      next();
    }).catch(next);
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return next(new AppError('Token expired', 401));
    }
    return next(new AppError('Invalid token', 401));
  }
}

// Role-based access control
export function requireRole(...roles: Array<'admin' | 'dispatcher' | 'driver'>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new AppError('Not authenticated', 401));
    if (!roles.includes(req.user.role)) {
      return next(new AppError('Insufficient permissions', 403));
    }
    next();
  };
}

// Org isolation: ensure user only accesses their org's data
export function requireOrg(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(new AppError('Not authenticated', 401));
  next();
}

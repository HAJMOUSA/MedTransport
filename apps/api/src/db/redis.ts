import Redis from 'ioredis';
import { logger } from '../lib/logger';

export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  retryStrategy: (times) => {
    if (times > 5) {
      logger.error('Redis connection failed after 5 retries');
      return null; // Stop retrying
    }
    return Math.min(times * 500, 3000); // Exponential backoff up to 3s
  },
});

redis.on('connect', () => logger.info('Redis connected'));
redis.on('error', (err) => logger.error('Redis error', { error: err.message }));
redis.on('reconnecting', () => logger.warn('Redis reconnecting...'));

// ─── Key builders ────────────────────────────────────────────────────────────
export const RedisKeys = {
  // OTP: trip:{tripId}:otp:{type}  (type = 'pickup' | 'dropoff')
  otp: (tripId: number, type: string) => `trip:${tripId}:otp:${type}`,

  // Driver location: driver:{driverId}:location
  driverLocation: (driverId: number) => `driver:${driverId}:location`,

  // All active drivers for an org: org:{orgId}:active_drivers
  activeDrivers: (orgId: number) => `org:${orgId}:active_drivers`,

  // Session blacklist (for logout)
  tokenBlacklist: (jti: string) => `blacklist:${jti}`,

  // Refresh token
  refreshToken: (userId: number) => `refresh:${userId}`,
} as const;

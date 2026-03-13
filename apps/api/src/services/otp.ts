import { randomInt } from 'crypto';
import bcrypt from 'bcryptjs';
import { redis, RedisKeys } from '../db/redis';
import { query } from '../db/pool';
import { sendSms } from './sms';
import { logger } from '../lib/logger';

const OTP_EXPIRY = parseInt(process.env.OTP_EXPIRY_SECONDS || '600', 10);

export interface OtpGenerateResult {
  otpEventId: number;
  expiresAt: Date;
}

/**
 * Generate a 6-digit OTP for trip pickup or dropoff.
 * Sends SMS to rider and stores hash in Redis + DB.
 */
export async function generateOtp(
  tripId: number,
  driverId: number,
  eventType: 'pickup' | 'dropoff',
  riderPhone: string,
  driverLat: number | null,
  driverLng: number | null,
): Promise<OtpGenerateResult> {
  // Generate cryptographically secure 6-digit OTP
  const otp = randomInt(100000, 999999).toString();
  const otpHash = await bcrypt.hash(otp, 8); // Lower rounds OK — OTP is short-lived

  const expiresAt = new Date(Date.now() + OTP_EXPIRY * 1000);

  // Store in Redis for fast verification (TTL = OTP_EXPIRY seconds)
  const redisKey = RedisKeys.otp(tripId, eventType);
  await redis.setex(redisKey, OTP_EXPIRY, otpHash);

  // Store in database for audit trail
  const result = await query<{ id: number }>(
    `INSERT INTO otp_events (trip_id, driver_id, event_type, rider_phone, otp_hash,
       trigger_lat, trigger_lng, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [tripId, driverId, eventType, riderPhone, otpHash,
     driverLat, driverLng, expiresAt]
  );

  const otpEventId = result[0].id;

  // Send SMS to rider
  const orgName = process.env.ORG_NAME || 'MidTransport';
  const message = eventType === 'pickup'
    ? `${orgName}: Your driver has arrived for pickup. Confirm with code: ${otp} (valid ${OTP_EXPIRY / 60} min)`
    : `${orgName}: You have arrived at your destination. Confirm with code: ${otp} (valid ${OTP_EXPIRY / 60} min)`;

  await sendSms(riderPhone, message);

  logger.info('OTP generated and sent', { tripId, eventType, otpEventId });

  return { otpEventId, expiresAt };
}

/**
 * Verify a 6-digit OTP entered by the driver.
 * Returns true if valid, false if invalid/expired.
 */
export async function verifyOtp(
  tripId: number,
  eventType: 'pickup' | 'dropoff',
  enteredOtp: string,
  driverLat: number | null,
  driverLng: number | null,
): Promise<{ success: boolean; otpEventId?: number; error?: string }> {
  const redisKey = RedisKeys.otp(tripId, eventType);
  const storedHash = await redis.get(redisKey);

  if (!storedHash) {
    return { success: false, error: 'OTP expired or not found' };
  }

  const match = await bcrypt.compare(enteredOtp.trim(), storedHash);

  // Find the pending OTP event
  const otpEvent = await query<{ id: number }>(
    `SELECT id FROM otp_events
     WHERE trip_id = $1 AND event_type = $2 AND status = 'pending'
     ORDER BY created_at DESC LIMIT 1`,
    [tripId, eventType]
  );

  const otpEventId = otpEvent[0]?.id;

  if (!match) {
    logger.warn('OTP verification failed', { tripId, eventType });
    return { success: false, error: 'Incorrect code. Please try again.' };
  }

  // Mark as verified in DB + remove from Redis
  await Promise.all([
    redis.del(redisKey),
    otpEventId ? query(
      `UPDATE otp_events
       SET status = 'verified', verified_at = NOW(), trigger_lat = $1, trigger_lng = $2
       WHERE id = $3`,
      [driverLat, driverLng, otpEventId]
    ) : Promise.resolve(),
  ]);

  logger.info('OTP verified successfully', { tripId, eventType, otpEventId });
  return { success: true, otpEventId };
}

/**
 * Record a fallback photo when rider has no phone.
 */
export async function recordFallback(
  tripId: number,
  driverId: number,
  eventType: 'pickup' | 'dropoff',
  riderPhone: string,
  photoFilename: string,
  lat: number | null,
  lng: number | null,
): Promise<number> {
  const expiresAt = new Date(Date.now() + OTP_EXPIRY * 1000);
  const result = await query<{ id: number }>(
    `INSERT INTO otp_events (trip_id, driver_id, event_type, rider_phone, otp_hash,
       trigger_lat, trigger_lng, status, photo_filename, verified_at, expires_at)
     VALUES ($1, $2, $3, $4, '', $5, $6, 'fallback_photo', $7, NOW(), $8)
     RETURNING id`,
    [tripId, driverId, eventType, riderPhone, lat, lng, photoFilename, expiresAt]
  );
  return result[0].id;
}

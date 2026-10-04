import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { redis, RedisKeys } from '../db/redis';
import { query } from '../db/pool';
import { checkGeofenceTriggers } from '../services/geofence';
import { generateOtp } from '../services/otp';
import { logger } from '../lib/logger';
import { JwtPayload } from '../middleware/auth';

interface LocationUpdate {
  lat: number;
  lng: number;
  speedMph?: number;
  headingDeg?: number;
  accuracyM?: number;
}

interface DriverInfo {
  driverId: number;
  userId: number;
  orgId: number;
  name: string;
}

// Track which sockets are drivers vs dispatchers
const driverSockets = new Map<string, DriverInfo>(); // socketId → driver info

export function registerLocationHandlers(io: Server): void {

  io.use(async (socket, next) => {
    // Authenticate socket connection via JWT
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('Authentication required'));

    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
      (socket as Socket & { user: JwtPayload }).user = payload;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const user = (socket as Socket & { user: JwtPayload }).user;
    logger.debug('Socket connected', { userId: user.userId, role: user.role });

    // Drivers join their org room + driver room
    if (user.role === 'driver') {
      socket.join(`org:${user.orgId}`);
      socket.join(`driver:${user.userId}`);

      // Self-heal: if this driver is already on shift (in the DB), re-register
      // them as active on (re)connect. Without this, a driver who was on shift
      // before the socket connected — or who reconnected after a network blip or
      // an API/Redis restart — would silently disappear from the dispatcher live
      // map until they manually toggled their shift off and on again.
      (async () => {
        try {
          const rows = await query<{ id: number; on_shift: boolean }>(
            `SELECT d.id, d.on_shift FROM drivers d
             WHERE d.user_id = $1 AND d.org_id = $2`,
            [user.userId, user.orgId]
          );
          const driver = rows[0];
          if (driver?.on_shift) {
            const userName = await query<{ name: string }>(
              'SELECT name FROM users WHERE id = $1',
              [user.userId]
            );
            driverSockets.set(socket.id, {
              driverId: driver.id,
              userId: user.userId,
              orgId: user.orgId,
              name: userName[0]?.name ?? 'Driver',
            });
            await redis.sadd(RedisKeys.activeDrivers(user.orgId), driver.id.toString());
          }
        } catch (err) {
          logger.error('driver reconnect self-heal failed', { error: (err as Error).message });
        }
      })();
    }

    // Dispatchers join their org room to receive driver updates
    if (user.role === 'dispatcher' || user.role === 'admin') {
      socket.join(`org:${user.orgId}:dispatchers`);
    }

    // ── driver:start-shift ──────────────────────────────────────────────────
    socket.on('driver:start-shift', async (data: { driverId: number }) => {
      try {
        const driver = await query<{ id: number; user_id: number; name: string }>(
          `UPDATE drivers SET on_shift = true, shift_started_at = NOW()
           WHERE id = $1 AND org_id = $2 RETURNING id, user_id`,
          [data.driverId, user.orgId]
        );

        if (driver[0]) {
          const userName = await query<{ name: string }>(
            'SELECT name FROM users WHERE id = $1',
            [user.userId]
          );

          driverSockets.set(socket.id, {
            driverId: data.driverId,
            userId: user.userId,
            orgId: user.orgId,
            name: userName[0]?.name ?? 'Driver',
          });

          // Mark driver as active in Redis set for the org
          await redis.sadd(RedisKeys.activeDrivers(user.orgId), data.driverId.toString());

          // Notify dispatchers
          io.to(`org:${user.orgId}:dispatchers`).emit('driver:shift-started', {
            driverId: data.driverId,
            userId: user.userId,
            timestamp: new Date().toISOString(),
          });
        }
      } catch (err) {
        logger.error('driver:start-shift error', { error: (err as Error).message });
      }
    });

    // ── driver:location-update ──────────────────────────────────────────────
    socket.on('driver:location-update', async (data: LocationUpdate & { driverId: number; tripId?: number }) => {
      const { driverId, lat, lng, speedMph, headingDeg, accuracyM, tripId } = data;

      // Validate coordinates
      if (!lat || !lng || lat < -90 || lat > 90 || lng < -180 || lng > 180) return;

      try {
        // Self-heal: ensure the driver is marked active for the org. Guards against
        // the driver falling out of the set after a reconnect or a Redis restart.
        await redis.sadd(RedisKeys.activeDrivers(user.orgId), driverId.toString());

        // 1. Update Redis Geo (instant dispatcher lookup)
        await redis.geoadd(
          `org:${user.orgId}:driver_positions`,
          lng, lat, driverId.toString()
        );

        // 2. Update driver's last known location in Redis hash
        await redis.hset(RedisKeys.driverLocation(driverId), {
          lat: lat.toString(),
          lng: lng.toString(),
          speed: (speedMph ?? 0).toString(),
          heading: (headingDeg ?? 0).toString(),
          accuracy: (accuracyM ?? 50).toString(),
          updatedAt: Date.now().toString(),
        });

        // 3. Persist to PostgreSQL (for route replay)
        const GPS_INTERVAL = parseInt(process.env.GPS_UPDATE_INTERVAL_S || '10', 10);
        // Only write to DB every GPS_INTERVAL seconds to reduce writes
        const lastWriteKey = `driver:${driverId}:last_db_write`;
        const lastWrite = await redis.get(lastWriteKey);
        const shouldWrite = !lastWrite || (Date.now() - parseInt(lastWrite, 10)) > GPS_INTERVAL * 1000;

        if (shouldWrite) {
          await redis.set(lastWriteKey, Date.now().toString(), 'EX', GPS_INTERVAL * 2);
          await query(
            `INSERT INTO driver_locations (driver_id, trip_id, latitude, longitude, speed_mph, heading_deg, accuracy_m)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [driverId, tripId ?? null, lat, lng, speedMph ?? null, headingDeg ?? null, accuracyM ?? null]
          );
        }

        // 4. Broadcast to dispatchers (real-time map update)
        io.to(`org:${user.orgId}:dispatchers`).emit('driver:position', {
          driverId,
          lat,
          lng,
          speedMph: speedMph ?? 0,
          headingDeg: headingDeg ?? 0,
          accuracyM: accuracyM ?? 50,
          timestamp: new Date().toISOString(),
        });

        // 5. Check geofence triggers
        const geofenceResult = await checkGeofenceTriggers(driverId, lat, lng);

        if ((geofenceResult.isInsidePickup || geofenceResult.isInsideDropoff) &&
            geofenceResult.tripId && geofenceResult.riderPhone && geofenceResult.eventType) {

          // Check if OTP already sent for this event (prevent duplicate OTPs)
          const otpSentKey = `trip:${geofenceResult.tripId}:otp_sent:${geofenceResult.eventType}`;
          const alreadySent = await redis.get(otpSentKey);

          if (!alreadySent) {
            // Mark as sent immediately (TTL = OTP expiry + buffer)
            await redis.setex(otpSentKey, 700, '1');

            // Generate and send OTP
            try {
              const otpResult = await generateOtp(
                geofenceResult.tripId,
                driverId,
                geofenceResult.eventType,
                geofenceResult.riderPhone,
                lat, lng
              );

              // Notify driver app to show OTP entry screen
              socket.emit('trip:otp-sent', {
                tripId: geofenceResult.tripId,
                eventType: geofenceResult.eventType,
                expiresAt: otpResult.expiresAt.toISOString(),
              });

              // Update trip status
              const newStatus = geofenceResult.eventType === 'pickup'
                ? 'arrived_pickup' : 'arrived_dropoff';
              await query(
                'UPDATE trips SET status = $1, updated_at = NOW() WHERE id = $2',
                [newStatus, geofenceResult.tripId]
              );

              // Notify dispatchers
              io.to(`org:${user.orgId}:dispatchers`).emit('trip:status-changed', {
                tripId: geofenceResult.tripId,
                status: newStatus,
                driverId,
                timestamp: new Date().toISOString(),
              });

            } catch (err) {
              logger.error('Failed to send geofence OTP', { error: (err as Error).message });
            }
          }
        }

      } catch (err) {
        logger.error('driver:location-update error', { error: (err as Error).message });
      }
    });

    // ── driver:end-shift ────────────────────────────────────────────────────
    socket.on('driver:end-shift', async (data: { driverId: number }) => {
      try {
        await query(
          'UPDATE drivers SET on_shift = false, updated_at = NOW() WHERE id = $1 AND org_id = $2',
          [data.driverId, user.orgId]
        );
        await redis.srem(RedisKeys.activeDrivers(user.orgId), data.driverId.toString());
        await redis.del(RedisKeys.driverLocation(data.driverId));

        driverSockets.delete(socket.id);

        io.to(`org:${user.orgId}:dispatchers`).emit('driver:shift-ended', {
          driverId: data.driverId,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        logger.error('driver:end-shift error', { error: (err as Error).message });
      }
    });

    // ── Clean up on disconnect ───────────────────────────────────────────────
    socket.on('disconnect', async () => {
      const driverInfo = driverSockets.get(socket.id);
      if (driverInfo) {
        driverSockets.delete(socket.id);

        // Only tear down tracking if the driver is genuinely off shift. A
        // transient disconnect (network blip, app backgrounded, reconnect) must
        // NOT wipe an on-shift driver from the live map — doing so previously
        // made drivers permanently vanish after any reconnect until they toggled
        // their shift. End-of-shift cleanup is handled by driver:end-shift.
        try {
          const rows = await query<{ on_shift: boolean }>(
            'SELECT on_shift FROM drivers WHERE id = $1 AND org_id = $2',
            [driverInfo.driverId, driverInfo.orgId]
          );
          const stillOnShift = rows[0]?.on_shift === true;

          // Another live socket for the same driver? Then don't tear down either.
          const hasAnotherSocket = [...driverSockets.values()]
            .some((d) => d.driverId === driverInfo.driverId);

          if (!stillOnShift && !hasAnotherSocket) {
            await redis.del(RedisKeys.driverLocation(driverInfo.driverId)).catch(() => {});
            await redis.srem(RedisKeys.activeDrivers(driverInfo.orgId), driverInfo.driverId.toString()).catch(() => {});
            io.to(`org:${driverInfo.orgId}:dispatchers`).emit('driver:disconnected', {
              driverId: driverInfo.driverId,
              timestamp: new Date().toISOString(),
            });
          }
        } catch (err) {
          logger.error('disconnect cleanup failed', { error: (err as Error).message });
        }
      }
      logger.debug('Socket disconnected', { userId: user.userId });
    });
  });
}

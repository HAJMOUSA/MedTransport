import { queryOne } from '../db/pool';
import { logger } from '../lib/logger';

const DEFAULT_RADIUS_M = parseInt(process.env.GEOFENCE_ARRIVAL_RADIUS_M || '100', 10);

export interface GeofenceCheckResult {
  isInsidePickup: boolean;
  isInsideDropoff: boolean;
  tripId?: number;
  riderPhone?: string;
  eventType?: 'pickup' | 'dropoff';
}

/**
 * Check if a driver's GPS position triggers any geofence for their active trip.
 * Uses PostGIS ST_DWithin for accurate distance calculation.
 */
export async function checkGeofenceTriggers(
  driverId: number,
  lat: number,
  lng: number,
): Promise<GeofenceCheckResult> {
  // Get the driver's current active trip
  const trip = await queryOne<{
    id: number;
    status: string;
    pickup_lat: number | null;
    pickup_lng: number | null;
    dropoff_lat: number | null;
    dropoff_lng: number | null;
    rider_phone: string;
  }>(
    `SELECT t.id, t.status, t.pickup_lat, t.pickup_lng, t.dropoff_lat, t.dropoff_lng,
            r.phone as rider_phone
     FROM trips t
     JOIN riders r ON r.id = t.rider_id
     WHERE t.driver_id = $1
       AND t.status IN ('dispatched', 'en_route_pickup', 'en_route_dropoff')
     ORDER BY t.scheduled_pickup_at ASC
     LIMIT 1`,
    [driverId]
  );

  if (!trip) return { isInsidePickup: false, isInsideDropoff: false };

  const result: GeofenceCheckResult = {
    isInsidePickup: false,
    isInsideDropoff: false,
    tripId: trip.id,
    riderPhone: trip.rider_phone,
  };

  const driverPoint = `ST_GeogFromText('POINT(${lng} ${lat})')`;

  // Check pickup geofence
  if (trip.pickup_lat && trip.pickup_lng &&
    (trip.status === 'dispatched' || trip.status === 'en_route_pickup')) {
    const pickupCheck = await queryOne<{ within: boolean }>(
      `SELECT ST_DWithin(
         ${driverPoint},
         ST_GeogFromText('POINT(${trip.pickup_lng} ${trip.pickup_lat})'),
         $1
       ) as within`,
      [DEFAULT_RADIUS_M]
    );

    if (pickupCheck?.within) {
      result.isInsidePickup = true;
      result.eventType = 'pickup';
      logger.info('Driver entered pickup geofence', { driverId, tripId: trip.id });
    }
  }

  // Check dropoff geofence
  if (trip.dropoff_lat && trip.dropoff_lng && trip.status === 'en_route_dropoff') {
    const dropoffCheck = await queryOne<{ within: boolean }>(
      `SELECT ST_DWithin(
         ${driverPoint},
         ST_GeogFromText('POINT(${trip.dropoff_lng} ${trip.dropoff_lat})'),
         $1
       ) as within`,
      [DEFAULT_RADIUS_M]
    );

    if (dropoffCheck?.within) {
      result.isInsideDropoff = true;
      result.eventType = 'dropoff';
      logger.info('Driver entered dropoff geofence', { driverId, tripId: trip.id });
    }
  }

  return result;
}

/**
 * Store or update a geofence for a common destination address.
 */
export async function upsertGeofence(
  orgId: number,
  address: string,
  lat: number,
  lng: number,
  radiusM: number = DEFAULT_RADIUS_M,
): Promise<number> {
  const result = await queryOne<{ id: number }>(
    `INSERT INTO geofences (org_id, address, latitude, longitude, radius_m)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [orgId, address, lat, lng, radiusM]
  );
  return result?.id ?? 0;
}

import { useEffect, useRef, useState, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useSocket } from '../../hooks/useSocket';
import { api } from '../../lib/api';
import { DriverPanel } from './DriverPanel';

type LatLng = [number, number];
const MAX_PATH_POINTS = 800; // cap per-driver trail length for performance

// Fix Leaflet default icon paths for bundlers
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Custom driver icons
const createDriverIcon = (color: string) => L.divIcon({
  className: '',
  html: `<div style="
    width:32px;height:32px;border-radius:50%;
    background:${color};border:3px solid white;
    box-shadow:0 2px 8px rgba(0,0,0,0.3);
    display:flex;align-items:center;justify-content:center;
    font-size:14px;cursor:pointer;
  ">🚗</div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

const activeIcon = createDriverIcon('#22c55e');
const idleIcon = createDriverIcon('#94a3b8');

export interface DriverPosition {
  driverId: number;
  lat: number;
  lng: number;
  speedMph: number;
  headingDeg: number;
  accuracyM: number;
  timestamp: string;
  driverName?: string;
}

interface Trip {
  id: number;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  rider_name: string;
  driver_name: string | null;
  status: string;
  scheduled_pickup_at: string | null; // null when will_call
}

interface LiveMapProps {
  initialDrivers?: DriverPosition[];
  trips?: Trip[];
}

// Pickup marker icon
const pickupIcon = L.divIcon({
  className: '',
  html: `<div style="background:#3b82f6;border:2px solid white;border-radius:4px;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:10px;box-shadow:0 1px 4px rgba(0,0,0,.3)">📍</div>`,
  iconSize: [20, 20], iconAnchor: [10, 10],
});
const dropoffIcon = L.divIcon({
  className: '',
  html: `<div style="background:#ef4444;border:2px solid white;border-radius:4px;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:10px;box-shadow:0 1px 4px rgba(0,0,0,.3)">🏥</div>`,
  iconSize: [20, 20], iconAnchor: [10, 10],
});

export function LiveMap({ initialDrivers = [], trips = [] }: LiveMapProps) {
  const socket = useSocket();
  const [drivers, setDrivers] = useState<Map<number, DriverPosition>>(
    new Map(initialDrivers.map(d => [d.driverId, d]))
  );
  const [selectedDriver, setSelectedDriver] = useState<DriverPosition | null>(null);
  const driverNamesRef = useRef<Map<number, string>>(new Map());
  // Per-driver traveled GPS route (raw points), drawn as a growing polyline.
  const [paths, setPaths] = useState<Map<number, LatLng[]>>(new Map());
  const seededRef = useRef<Set<number>>(new Set());

  // Merge in drivers fetched from the REST snapshot (on-shift drivers that may
  // not have emitted a live position since the map opened). Refetched on an
  // interval by the parent, so this runs whenever the snapshot changes.
  useEffect(() => {
    if (!initialDrivers.length) return;
    setDrivers(prev => {
      const updated = new Map(prev);
      for (const d of initialDrivers) {
        if (d.driverName) driverNamesRef.current.set(d.driverId, d.driverName);
        const existing = updated.get(d.driverId);
        // Don't clobber a fresher live-socket position with an older snapshot.
        if (!existing || new Date(d.timestamp) >= new Date(existing.timestamp)) {
          updated.set(d.driverId, d);
        }
      }
      return updated;
    });
  }, [initialDrivers]);

  // Seed each driver's recent route trail once (REST), then grow it from live
  // socket events. Runs whenever a new driver appears on the map.
  useEffect(() => {
    for (const driverId of drivers.keys()) {
      if (seededRef.current.has(driverId)) continue;
      seededRef.current.add(driverId);
      api.get(`/api/tracking/drivers/${driverId}/path`)
        .then(r => {
          const pts: LatLng[] = (r.data as Array<{ lat: number; lng: number }>).map(p => [p.lat, p.lng]);
          if (!pts.length) return;
          setPaths(prev => {
            if (prev.has(driverId)) return prev; // live points already started the trail
            const next = new Map(prev);
            next.set(driverId, pts.slice(-MAX_PATH_POINTS));
            return next;
          });
        })
        .catch(() => { seededRef.current.delete(driverId); }); // allow a later retry
    }
  }, [drivers]);

  // Listen for real-time driver position updates via Socket.io
  useEffect(() => {
    if (!socket) return;

    const handlePosition = (data: DriverPosition) => {
      setDrivers(prev => {
        const updated = new Map(prev);
        updated.set(data.driverId, {
          ...data,
          driverName: driverNamesRef.current.get(data.driverId),
        });
        return updated;
      });
      // Append to the driver's traveled route (skip duplicate consecutive points).
      setPaths(prev => {
        const arr = prev.get(data.driverId) ?? [];
        const last = arr[arr.length - 1];
        if (last && last[0] === data.lat && last[1] === data.lng) return prev;
        const next = new Map(prev);
        next.set(data.driverId, [...arr, [data.lat, data.lng] as LatLng].slice(-MAX_PATH_POINTS));
        return next;
      });
    };

    const handleDisconnected = (data: { driverId: number }) => {
      setDrivers(prev => {
        const updated = new Map(prev);
        updated.delete(data.driverId);
        return updated;
      });
      setPaths(prev => {
        if (!prev.has(data.driverId)) return prev;
        const next = new Map(prev);
        next.delete(data.driverId);
        return next;
      });
      seededRef.current.delete(data.driverId);
    };

    socket.on('driver:position', handlePosition);
    socket.on('driver:disconnected', handleDisconnected);

    return () => {
      socket.off('driver:position', handlePosition);
      socket.off('driver:disconnected', handleDisconnected);
    };
  }, [socket]);

  const handleDriverClick = useCallback((driver: DriverPosition) => {
    setSelectedDriver(driver);
  }, []);

  return (
    <div className="relative w-full h-full min-h-[500px]">
      <MapContainer
        center={[39.5, -98.35]} // Center of USA
        zoom={5}
        className="w-full h-full rounded-lg"
        style={{ minHeight: 500 }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />

        {/* Driver traveled routes (raw GPS trail) */}
        {Array.from(paths.entries()).map(([driverId, pts]) => (
          pts.length >= 2 && (
            <Polyline
              key={`path-${driverId}`}
              positions={pts}
              pathOptions={{
                color: selectedDriver?.driverId === driverId ? '#1d4ed8' : '#60a5fa',
                weight: selectedDriver?.driverId === driverId ? 5 : 3,
                opacity: 0.85,
              }}
            />
          )
        ))}

        {/* Driver markers */}
        {Array.from(drivers.values()).map((driver) => {
          const isActive = driver.speedMph > 1;
          return (
            <Marker
              key={driver.driverId}
              position={[driver.lat, driver.lng]}
              icon={isActive ? activeIcon : idleIcon}
              eventHandlers={{ click: () => handleDriverClick(driver) }}
            >
              <Popup>
                <div className="text-sm font-medium">
                  <div>{driver.driverName ?? `Driver #${driver.driverId}`}</div>
                  <div className="text-gray-500">{driver.speedMph.toFixed(0)} mph</div>
                  <div className="text-gray-400 text-xs">
                    Updated {new Date(driver.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {/* Trip pickup markers */}
        {trips.filter(t => t.pickup_lat && t.pickup_lng).map(trip => (
          <Marker
            key={`pickup-${trip.id}`}
            position={[trip.pickup_lat!, trip.pickup_lng!]}
            icon={pickupIcon}
          >
            <Popup>
              <div className="text-sm">
                <div className="font-medium">{trip.rider_name}</div>
                <div className="text-blue-600">Pickup</div>
                <div className="text-gray-500">
                  {trip.scheduled_pickup_at
                    ? new Date(trip.scheduled_pickup_at).toLocaleTimeString([], { timeStyle: 'short' })
                    : 'Will Call'}
                </div>
              </div>
            </Popup>
          </Marker>
        ))}

        {/* Trip dropoff markers */}
        {trips.filter(t => t.dropoff_lat && t.dropoff_lng).map(trip => (
          <Marker
            key={`dropoff-${trip.id}`}
            position={[trip.dropoff_lat!, trip.dropoff_lng!]}
            icon={dropoffIcon}
          >
            <Popup>
              <div className="text-sm">
                <div className="font-medium">{trip.rider_name}</div>
                <div className="text-red-600">Dropoff</div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      {/* Driver detail panel */}
      {selectedDriver && (
        <DriverPanel
          driver={selectedDriver}
          onClose={() => setSelectedDriver(null)}
        />
      )}

      {/* Live indicator */}
      <div className="absolute top-3 right-3 z-[1000] bg-white rounded-full px-3 py-1 text-xs font-medium shadow flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
        {drivers.size} active driver{drivers.size !== 1 ? 's' : ''}
      </div>
    </div>
  );
}

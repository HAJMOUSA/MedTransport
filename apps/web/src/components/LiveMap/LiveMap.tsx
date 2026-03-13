import { useEffect, useRef, useState, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useSocket } from '../../hooks/useSocket';
import { DriverPanel } from './DriverPanel';

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
  scheduled_pickup_at: string;
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
    };

    const handleDisconnected = (data: { driverId: number }) => {
      setDrivers(prev => {
        const updated = new Map(prev);
        updated.delete(data.driverId);
        return updated;
      });
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
                  {new Date(trip.scheduled_pickup_at).toLocaleTimeString([], { timeStyle: 'short' })}
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

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../../lib/api';

type LatLng = [number, number];
interface RoutePoint { lat: number; lng: number; speedMph: number; recordedAt: string }

const pinIcon = (color: string, glyph: string) => L.divIcon({
  className: '',
  html: `<div style="background:${color};border:2px solid white;border-radius:4px;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:10px;box-shadow:0 1px 4px rgba(0,0,0,.3)">${glyph}</div>`,
  iconSize: [20, 20], iconAnchor: [10, 10],
});
const pickupIcon = pinIcon('#3b82f6', '📍');
const dropoffIcon = pinIcon('#ef4444', '🏁');

function FitBounds({ points }: { points: LatLng[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 1) map.setView(points[0], 15);
    else if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 16 });
  }, [points, map]);
  return null;
}

export function TripRouteMap({ tripId, pickup, dropoff }: {
  tripId: number;
  pickup?: LatLng | null;
  dropoff?: LatLng | null;
}) {
  const { data: pts = [], isLoading, isError } = useQuery<RoutePoint[]>({
    queryKey: ['trip-route', tripId],
    queryFn: () => api.get(`/api/tracking/trips/${tripId}/route`).then(r => r.data),
  });

  const path: LatLng[] = pts.map(p => [p.lat, p.lng]);
  const all: LatLng[] = [...path, ...(pickup ? [pickup] : []), ...(dropoff ? [dropoff] : [])];

  if (isLoading) return <div className="h-64 flex items-center justify-center text-sm text-gray-400 bg-gray-50 rounded-lg">Loading route…</div>;
  if (isError) return <div className="h-64 flex items-center justify-center text-sm text-red-500 bg-red-50 rounded-lg">Couldn't load the route.</div>;
  if (path.length === 0) {
    return (
      <div className="h-24 flex items-center justify-center text-center text-sm text-gray-500 bg-gray-50 rounded-lg px-4">
        No GPS route was recorded for this trip.
      </div>
    );
  }

  const first = pts[0], last = pts[pts.length - 1];
  const fmt = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="space-y-2">
      <div className="h-64 rounded-lg overflow-hidden border border-gray-200">
        <MapContainer center={path[0]} zoom={14} className="w-full h-full" style={{ minHeight: 256 }}>
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />
          <Polyline positions={path} pathOptions={{ color: '#2563eb', weight: 4, opacity: 0.85 }} />
          {pickup && <Marker position={pickup} icon={pickupIcon}><Popup>Pickup</Popup></Marker>}
          {dropoff && <Marker position={dropoff} icon={dropoffIcon}><Popup>Drop-off</Popup></Marker>}
          <FitBounds points={all} />
        </MapContainer>
      </div>
      <p className="text-xs text-gray-400">
        {pts.length} GPS point{pts.length === 1 ? '' : 's'}
        {first && last && ` · ${fmt(first.recordedAt)} → ${fmt(last.recordedAt)}`}
      </p>
    </div>
  );
}

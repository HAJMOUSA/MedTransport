import { useQuery } from '@tanstack/react-query';
import { X, Gauge, Navigation, Clock, CheckCircle } from 'lucide-react';
import { api } from '../../lib/api';
import { format } from 'date-fns';
import type { DriverPosition } from './LiveMap';

interface DriverMetrics {
  trips_completed: number;
  no_shows: number;
  on_time_percent: number | null;
  total_miles: number;
}

interface DriverPanelProps {
  driver: DriverPosition;
  onClose: () => void;
}

export function DriverPanel({ driver, onClose }: DriverPanelProps) {
  const today = format(new Date(), 'yyyy-MM-dd');

  const { data: metrics } = useQuery<DriverMetrics>({
    queryKey: ['driver-metrics', driver.driverId, today],
    queryFn: () =>
      api.get(`/api/tracking/drivers/${driver.driverId}/metrics?date=${today}`).then(r => r.data),
    refetchInterval: 30_000,
  });

  return (
    <div className="absolute bottom-4 left-4 z-[1000] bg-white rounded-xl shadow-lg border border-gray-200 w-64 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-semibold text-gray-900">
            {driver.driverName ?? `Driver #${driver.driverId}`}
          </h3>
          <p className="text-xs text-gray-400">
            Updated {new Date(driver.timestamp).toLocaleTimeString()}
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-full hover:bg-gray-100 transition-colors"
          aria-label="Close driver panel"
        >
          <X className="w-4 h-4 text-gray-500" />
        </button>
      </div>

      {/* Real-time stats */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <MetricChip icon={<Gauge className="w-4 h-4" />} label="Speed" value={`${driver.speedMph.toFixed(0)} mph`} />
        <MetricChip icon={<Navigation className="w-4 h-4" />} label="Heading" value={headingLabel(driver.headingDeg)} />
      </div>

      {/* Today's metrics */}
      {metrics && (
        <div className="border-t border-gray-100 pt-3 space-y-1.5">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Today</p>
          <MetricRow icon={<CheckCircle className="w-3.5 h-3.5 text-green-500" />}
            label="Trips completed" value={metrics.trips_completed.toString()} />
          <MetricRow icon={<Clock className="w-3.5 h-3.5 text-amber-500" />}
            label="On-time rate"
            value={metrics.on_time_percent != null ? `${metrics.on_time_percent}%` : '—'} />
          <MetricRow icon={<Navigation className="w-3.5 h-3.5 text-blue-500" />}
            label="Miles driven" value={`${metrics.total_miles} mi`} />
        </div>
      )}
    </div>
  );
}

function MetricChip({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-lg px-2 py-1.5 flex items-center gap-1.5">
      <span className="text-gray-400">{icon}</span>
      <div>
        <div className="text-xs text-gray-400">{label}</div>
        <div className="text-sm font-semibold text-gray-800">{value}</div>
      </div>
    </div>
  );
}

function MetricRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="flex items-center gap-1.5 text-gray-600">
        {icon} {label}
      </div>
      <span className="font-medium text-gray-800">{value}</span>
    </div>
  );
}

function headingLabel(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

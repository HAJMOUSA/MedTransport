import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { Car, CheckCircle, Clock, AlertTriangle, TrendingUp, Upload, Plus, Users, FileText } from 'lucide-react';
import { format } from 'date-fns';
import { CSVImport } from '../components/CSVImport/CSVImport';

interface DashboardStats {
  trips: {
    total_trips: number;
    completed: number;
    cancelled: number;
    no_shows: number;
    avg_delay_minutes: number | null;
    total_miles: number;
  };
  otp: {
    total_otp_events: number;
    verified: number;
    fallback_photos: number;
  };
  drivers: Array<{ driver_name: string; completed: number; on_time_pct: number | null }>;
}

export function Dashboard() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showImport, setShowImport] = useState(false);

  const { data, isLoading } = useQuery<DashboardStats>({
    queryKey: ['dashboard', today],
    queryFn: () => api.get(`/api/reports/summary?startDate=${today}&endDate=${today}`).then(r => r.data),
    refetchInterval: 30_000, // Refresh every 30s
  });

  const stats = data?.trips;
  const otpStats = data?.otp;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Car className="w-6 h-6 text-blue-600" />}
          label="Today's Trips"
          value={isLoading ? '–' : (stats?.total_trips ?? 0).toString()}
          bg="bg-blue-50"
        />
        <StatCard
          icon={<CheckCircle className="w-6 h-6 text-green-600" />}
          label="Completed"
          value={isLoading ? '–' : (stats?.completed ?? 0).toString()}
          bg="bg-green-50"
        />
        <StatCard
          icon={<Clock className="w-6 h-6 text-amber-600" />}
          label="Avg Delay"
          value={isLoading ? '–' : stats?.avg_delay_minutes != null
            ? `${stats.avg_delay_minutes} min` : 'On time'}
          bg="bg-amber-50"
        />
        <StatCard
          icon={<AlertTriangle className="w-6 h-6 text-red-600" />}
          label="No-shows"
          value={isLoading ? '–' : (stats?.no_shows ?? 0).toString()}
          bg="bg-red-50"
        />
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-800 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <button
            onClick={() => setShowImport(true)}
            className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-dashed border-blue-300 bg-blue-50 hover:bg-blue-100 hover:border-blue-400 transition-colors group"
          >
            <div className="w-10 h-10 rounded-full bg-blue-100 group-hover:bg-blue-200 flex items-center justify-center transition-colors">
              <Upload className="w-5 h-5 text-blue-600" />
            </div>
            <span className="text-sm font-medium text-blue-700">Import Riders</span>
            <span className="text-xs text-blue-500">CSV upload</span>
          </button>

          <button
            onClick={() => navigate('/trips')}
            className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-200 bg-gray-50 hover:bg-gray-100 transition-colors group"
          >
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
              <Plus className="w-5 h-5 text-green-600" />
            </div>
            <span className="text-sm font-medium text-gray-700">New Trip</span>
            <span className="text-xs text-gray-400">Trip board</span>
          </button>

          <button
            onClick={() => navigate('/riders')}
            className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-200 bg-gray-50 hover:bg-gray-100 transition-colors group"
          >
            <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
              <Users className="w-5 h-5 text-purple-600" />
            </div>
            <span className="text-sm font-medium text-gray-700">Manage Riders</span>
            <span className="text-xs text-gray-400">View all riders</span>
          </button>

          <button
            onClick={() => navigate('/reports')}
            className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-200 bg-gray-50 hover:bg-gray-100 transition-colors group"
          >
            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
              <FileText className="w-5 h-5 text-amber-600" />
            </div>
            <span className="text-sm font-medium text-gray-700">Reports</span>
            <span className="text-xs text-gray-400">Analytics</span>
          </button>
        </div>
      </div>

      {/* CSV Import Modal */}
      {showImport && (
        <CSVImport
          onClose={() => setShowImport(false)}
          onComplete={() => queryClient.invalidateQueries({ queryKey: ['riders'] })}
        />
      )}

      {/* OTP Verification Stats */}
      {otpStats && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-5 h-5 text-purple-600" />
            <h2 className="font-semibold text-gray-800">OTP Verification Today</h2>
          </div>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-purple-700">{otpStats.verified}</div>
              <div className="text-xs text-gray-500 mt-1">SMS Verified</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-blue-700">{otpStats.fallback_photos}</div>
              <div className="text-xs text-gray-500 mt-1">Photo Fallback</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-700">{otpStats.total_otp_events}</div>
              <div className="text-xs text-gray-500 mt-1">Total Events</div>
            </div>
          </div>
        </div>
      )}

      {/* Driver Performance */}
      {data?.drivers && data.drivers.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-800 mb-3">Driver Performance Today</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2 font-medium">Driver</th>
                  <th className="pb-2 font-medium text-right">Trips</th>
                  <th className="pb-2 font-medium text-right">On-Time</th>
                </tr>
              </thead>
              <tbody>
                {data.drivers.map((d) => (
                  <tr key={d.driver_name} className="border-b border-gray-50">
                    <td className="py-2 text-gray-800">{d.driver_name}</td>
                    <td className="py-2 text-right font-medium">{d.completed}</td>
                    <td className="py-2 text-right">
                      <span className={`font-medium ${
                        d.on_time_pct == null ? 'text-gray-400' :
                        d.on_time_pct >= 80 ? 'text-green-600' :
                        d.on_time_pct >= 60 ? 'text-amber-600' : 'text-red-600'
                      }`}>
                        {d.on_time_pct != null ? `${d.on_time_pct}%` : '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, bg }: {
  icon: React.ReactNode; label: string; value: string; bg: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className={`inline-flex p-2 rounded-lg ${bg} mb-3`}>{icon}</div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-sm text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import {
  CalendarDays,
  TrendingUp,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ShieldCheck,
  Car,
  Download,
} from 'lucide-react';

interface ReportSummary {
  period: { start: string; end: string };
  trips: {
    total_trips: string; completed: string; cancelled: string;
    no_shows: string; avg_delay_minutes: string | null; total_miles: string | null;
  };
  otp: {
    total_otp_events: string; verified: string; fallback_photos: string; expired: string;
  };
  drivers: Array<{ driver_name: string; completed: string; on_time_pct: string | null }>;
}

function fmt(date: Date) {
  return date.toISOString().split('T')[0];
}

const today = new Date();
const thirtyDaysAgo = new Date(today);
thirtyDaysAgo.setDate(today.getDate() - 30);

export function Reports() {
  const [startDate, setStartDate] = useState(fmt(thirtyDaysAgo));
  const [endDate, setEndDate] = useState(fmt(today));

  const { data, isLoading, refetch } = useQuery<ReportSummary>({
    queryKey: ['reports', startDate, endDate],
    queryFn: () =>
      api.get('/api/reports/summary', { params: { startDate, endDate } }).then(r => r.data),
  });

  const totalTrips = Number(data?.trips.total_trips ?? 0);
  const completed = Number(data?.trips.completed ?? 0);
  const completionRate = totalTrips > 0 ? Math.round((completed / totalTrips) * 1000) / 10 : 0;
  const otpTotal = Number(data?.otp.total_otp_events ?? 0);
  const otpVerified = Number(data?.otp.verified ?? 0);
  const verificationRate = otpTotal > 0 ? Math.round((otpVerified / otpTotal) * 1000) / 10 : 0;
  const avgDelay = data?.trips.avg_delay_minutes != null ? Number(data.trips.avg_delay_minutes) : null;

  const handleExport = () => {
    if (!data) return;
    const rows = [
      ['Driver', 'Trips Completed', 'On-Time %'],
      ...data.drivers.map(d => [d.driver_name, Number(d.completed), d.on_time_pct ?? '', '']),
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `midtransport-report-${startDate}-to-${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-sm text-gray-500 mt-0.5">Trip performance and driver analytics</p>
        </div>
        <button
          onClick={handleExport}
          disabled={!data}
          className="flex items-center gap-2 border border-gray-300 text-gray-700 rounded-lg px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-40 transition-colors"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      {/* Date range filter */}
      <div className="flex flex-wrap items-center gap-3 mb-6 bg-white border border-gray-200 rounded-xl p-4">
        <CalendarDays className="w-4 h-4 text-gray-500" />
        <span className="text-sm text-gray-700 font-medium">Date range:</span>
        <input
          type="date"
          value={startDate}
          onChange={e => setStartDate(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <span className="text-gray-400">—</span>
        <input
          type="date"
          value={endDate}
          onChange={e => setEndDate(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={() => refetch()}
          className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
        >
          Apply
        </button>

        {/* Quick ranges */}
        {[
          { label: 'Today', days: 0 },
          { label: '7 days', days: 7 },
          { label: '30 days', days: 30 },
          { label: '90 days', days: 90 },
        ].map(({ label, days }) => (
          <button
            key={label}
            onClick={() => {
              const end = new Date();
              const start = new Date();
              start.setDate(end.getDate() - days);
              setStartDate(fmt(start));
              setEndDate(fmt(end));
            }}
            className="text-xs text-blue-600 hover:underline"
          >
            {label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-28 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : data ? (
        <div className="space-y-6">
          {/* KPI cards */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard
              icon={<TrendingUp className="w-5 h-5 text-blue-500" />}
              label="Total Trips"
              value={totalTrips}
              sub="in selected period"
              color="blue"
            />
            <KPICard
              icon={<CheckCircle2 className="w-5 h-5 text-green-500" />}
              label="Completion Rate"
              value={`${completionRate}%`}
              sub={`${completed} completed`}
              color="green"
            />
            <KPICard
              icon={<Clock className="w-5 h-5 text-amber-500" />}
              label="Avg Pickup Delay"
              value={avgDelay != null ? `${avgDelay} min` : '—'}
              sub="across completed trips"
              color="amber"
            />
            <KPICard
              icon={<ShieldCheck className="w-5 h-5 text-purple-500" />}
              label="OTP Verification"
              value={`${verificationRate}%`}
              sub={`${otpVerified} / ${otpTotal} events`}
              color="purple"
            />
          </div>

          {/* Secondary stats */}
          <div className="grid sm:grid-cols-3 gap-4">
            <StatBox label="No-Shows" value={Number(data.trips.no_shows)} icon={<AlertTriangle className="w-4 h-4 text-red-500" />} />
            <StatBox label="Cancelled" value={Number(data.trips.cancelled)} icon={<AlertTriangle className="w-4 h-4 text-amber-500" />} />
            <StatBox label="Fallback Photos" value={Number(data.otp.fallback_photos)} icon={<ShieldCheck className="w-4 h-4 text-gray-500" />} />
          </div>

          {/* Driver performance table */}
          {data.drivers.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
                <Car className="w-4 h-4 text-gray-500" />
                <h2 className="font-semibold text-gray-900">Driver Performance</h2>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-5 py-3 font-medium text-gray-600">Driver</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-600">Trips</th>
                    <th className="text-right px-5 py-3 font-medium text-gray-600">On-Time</th>
                  </tr>
                </thead>
                <tbody>
                  {data.drivers.map((d) => (
                    <tr key={d.driver_name} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-5 py-3 font-medium text-gray-900">{d.driver_name}</td>
                      <td className="px-5 py-3 text-right text-gray-700">{Number(d.completed)}</td>
                      <td className="px-5 py-3 text-right">
                        <span className={`font-medium ${
                          Number(d.on_time_pct) >= 80 ? 'text-green-600' :
                          Number(d.on_time_pct) >= 60 ? 'text-amber-600' : 'text-red-500'
                        }`}>
                          {d.on_time_pct != null ? Number(d.on_time_pct) : '—'}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function KPICard({
  icon, label, value, sub, color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub: string;
  color: 'blue' | 'green' | 'amber' | 'purple';
}) {
  const bg = {
    blue: 'bg-blue-50',
    green: 'bg-green-50',
    amber: 'bg-amber-50',
    purple: 'bg-purple-50',
  }[color];

  return (
    <div className={`${bg} rounded-xl p-4`}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs font-medium text-gray-600">{label}</span>
      </div>
      <p className="text-3xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{sub}</p>
    </div>
  );
}

function StatBox({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3">
      {icon}
      <div>
        <p className="text-xl font-bold text-gray-900">{value}</p>
        <p className="text-xs text-gray-500">{label}</p>
      </div>
    </div>
  );
}

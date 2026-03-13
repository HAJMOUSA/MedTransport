import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import {
  Search,
  Car,
  Phone,
  Wifi,
  WifiOff,
  MoreHorizontal,
  Pencil,
  X,
  AlertCircle,
  Clock,
  Plus,
} from 'lucide-react';

interface Driver {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  vehicle_name: string | null;
  vehicle_type: string | null;
  license_plate: string | null;
  on_shift: boolean;
  shift_started_at: string | null;
  license_number: string | null;
  license_expiry: string | null;
}

interface DriverMetrics {
  trips_completed: number;
  on_time_percent: number;
  total_miles: number;
}

export function Drivers() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [editDriver, setEditDriver] = useState<Driver | null>(null);
  const [form, setForm] = useState({ phone: '', license_number: '', license_expiry: '' });
  const [showAddDriver, setShowAddDriver] = useState(false);

  const { data: drivers = [], isLoading } = useQuery<Driver[]>({
    queryKey: ['drivers', search],
    queryFn: () =>
      api.get('/api/drivers', { params: { search } }).then(r => r.data),
    refetchInterval: 30_000,
  });

  const updateDriver = useMutation({
    mutationFn: ({ id, body }: { id: number; body: typeof form }) =>
      api.put(`/api/drivers/${id}`, body).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drivers'] });
      setEditDriver(null);
    },
  });

  const openEdit = (driver: Driver) => {
    setEditDriver(driver);
    setForm({
      phone: driver.phone ?? '',
      license_number: driver.license_number ?? '',
      license_expiry: driver.license_expiry ? driver.license_expiry.split('T')[0] : '',
    });
    setOpenMenuId(null);
  };

  const filtered = drivers.filter(d =>
    d.name.toLowerCase().includes(search.toLowerCase()) ||
    d.vehicle_name?.toLowerCase().includes(search.toLowerCase()) ||
    d.license_plate?.toLowerCase().includes(search.toLowerCase())
  );

  const onShiftCount = drivers.filter(d => d.on_shift).length;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Drivers</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {onShiftCount} on shift · {drivers.length} total
          </p>
        </div>
        <button
          onClick={() => setShowAddDriver(true)}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Driver
        </button>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: 'On Shift', value: onShiftCount, icon: <Wifi className="w-5 h-5 text-green-500" />, color: 'text-green-700' },
          { label: 'Off Shift', value: drivers.length - onShiftCount, icon: <WifiOff className="w-5 h-5 text-gray-400" />, color: 'text-gray-700' },
          { label: 'Total Drivers', value: drivers.length, icon: <Car className="w-5 h-5 text-blue-500" />, color: 'text-blue-700' },
        ].map(({ label, value, icon, color }) => (
          <div key={label} className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3">
            {icon}
            <div>
              <p className={`text-xl font-bold ${color}`}>{value}</p>
              <p className="text-xs text-gray-500">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search by name or vehicle…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        />
      </div>

      {/* Driver cards */}
      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-40 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <Car className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No drivers found</p>
          <p className="text-xs text-gray-400 mt-1">Click "Add Driver" to create your first driver.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(driver => (
            <DriverCard
              key={driver.id}
              driver={driver}
              isMenuOpen={openMenuId === driver.id}
              onMenuToggle={() => setOpenMenuId(openMenuId === driver.id ? null : driver.id)}
              onEdit={() => openEdit(driver)}
            />
          ))}
        </div>
      )}

      {/* Add Driver Modal */}
      {showAddDriver && <AddDriverModal onClose={() => setShowAddDriver(false)} />}

      {/* Edit Modal */}
      {editDriver && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b">
              <h2 className="text-lg font-bold text-gray-900">Edit Driver — {editDriver.name}</h2>
              <button onClick={() => setEditDriver(null)} className="p-1 rounded-full hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); updateDriver.mutate({ id: editDriver.id, body: form }); }}
              className="p-5 space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="+15551234567"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">License Number</label>
                <input
                  value={form.license_number}
                  onChange={e => setForm(f => ({ ...f, license_number: e.target.value }))}
                  placeholder="DL-12345678"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">License Expiry</label>
                <input
                  type="date"
                  value={form.license_expiry}
                  onChange={e => setForm(f => ({ ...f, license_expiry: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {updateDriver.error && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{(updateDriver.error as Error).message}</p>
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setEditDriver(null)}
                  className="flex-1 border border-gray-300 text-gray-700 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" disabled={updateDriver.isPending}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50 transition-colors">
                  {updateDriver.isPending ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function AddDriverModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    licenseNumber: '',
    licenseExpiry: '',
  });

  const createDriver = useMutation({
    mutationFn: (data: typeof form) =>
      api.post('/api/drivers', {
        ...data,
        licenseNumber: data.licenseNumber || undefined,
        licenseExpiry: data.licenseExpiry || undefined,
      }).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drivers'] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-lg font-bold text-gray-900">Add New Driver</h2>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-100" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form
          onSubmit={e => { e.preventDefault(); createDriver.mutate(form); }}
          className="p-5 space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
            <input
              required
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Jane Smith"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
            <input
              type="email"
              required
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="jane@example.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone *</label>
            <input
              required
              value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              placeholder="+15551234567"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Initial Password *</label>
            <input
              type="password"
              required
              minLength={8}
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              placeholder="Min 8 characters"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">License Number</label>
            <input
              value={form.licenseNumber}
              onChange={e => setForm(f => ({ ...f, licenseNumber: e.target.value }))}
              placeholder="DL-12345678"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">License Expiry</label>
            <input
              type="date"
              value={form.licenseExpiry}
              onChange={e => setForm(f => ({ ...f, licenseExpiry: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {createDriver.error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{(createDriver.error as Error).message}</p>
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-300 text-gray-700 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={createDriver.isPending}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50 transition-colors">
              {createDriver.isPending ? 'Creating…' : 'Create Driver'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DriverCard({
  driver,
  isMenuOpen,
  onMenuToggle,
  onEdit,
}: {
  driver: Driver;
  isMenuOpen: boolean;
  onMenuToggle: () => void;
  onEdit: () => void;
}) {
  const { data: metrics } = useQuery<DriverMetrics>({
    queryKey: ['driver-metrics', driver.id],
    queryFn: () => api.get(`/api/tracking/drivers/${driver.id}/metrics`).then(r => r.data),
    enabled: driver.on_shift,
    refetchInterval: driver.on_shift ? 30_000 : false,
  });

  const shiftDuration = driver.shift_started_at
    ? Math.round((Date.now() - new Date(driver.shift_started_at).getTime()) / 60000)
    : null;

  return (
    <div className={`bg-white border rounded-xl p-4 relative ${driver.on_shift ? 'border-green-200' : 'border-gray-200'}`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${driver.on_shift ? 'bg-green-500' : 'bg-gray-300'}`} />
          <div>
            <p className="font-semibold text-gray-900 text-sm">{driver.name}</p>
            {driver.vehicle_name && (
              <p className="text-xs text-gray-500">{driver.vehicle_name} · {driver.license_plate}</p>
            )}
          </div>
        </div>
        <div className="relative">
          <button onClick={onMenuToggle} className="p-1 rounded hover:bg-gray-100">
            <MoreHorizontal className="w-4 h-4 text-gray-400" />
          </button>
          {isMenuOpen && (
            <div className="absolute right-0 top-7 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-10 min-w-32">
              <button
                onClick={onEdit}
                className="flex items-center gap-2 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <Pencil className="w-3.5 h-3.5" />
                Edit
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Phone */}
      {driver.phone && (
        <a href={`tel:${driver.phone}`} className="flex items-center gap-1.5 text-xs text-blue-600 hover:underline mb-3">
          <Phone className="w-3 h-3" />
          {driver.phone}
        </a>
      )}

      {/* Status */}
      <div className="flex items-center gap-1.5 mb-3">
        {driver.on_shift ? (
          <>
            <span className="text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full">On Shift</span>
            {shiftDuration !== null && (
              <span className="flex items-center gap-1 text-xs text-gray-500">
                <Clock className="w-3 h-3" />
                {shiftDuration < 60 ? `${shiftDuration}m` : `${Math.floor(shiftDuration / 60)}h ${shiftDuration % 60}m`}
              </span>
            )}
          </>
        ) : (
          <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">Off Shift</span>
        )}
      </div>

      {/* Today metrics */}
      {metrics && (
        <div className="grid grid-cols-3 gap-2 pt-3 border-t border-gray-100">
          <div className="text-center">
            <p className="text-sm font-bold text-gray-900">{metrics.trips_completed}</p>
            <p className="text-xs text-gray-400">Trips</p>
          </div>
          <div className="text-center">
            <p className={`text-sm font-bold ${metrics.on_time_percent >= 80 ? 'text-green-600' : metrics.on_time_percent >= 60 ? 'text-amber-600' : 'text-red-500'}`}>
              {metrics.on_time_percent}%
            </p>
            <p className="text-xs text-gray-400">On-time</p>
          </div>
          <div className="text-center">
            <p className="text-sm font-bold text-gray-900">{metrics.total_miles}</p>
            <p className="text-xs text-gray-400">Miles</p>
          </div>
        </div>
      )}
    </div>
  );
}

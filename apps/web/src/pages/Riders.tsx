import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { CSVImport } from '../components/CSVImport/CSVImport';
import {
  Search,
  Plus,
  Upload,
  Phone,
  MapPin,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Archive,
  X,
  User,
  AlertCircle,
} from 'lucide-react';

interface Rider {
  id: number;
  name: string;
  phone: string;
  phone_alt: string | null;
  email: string | null;
  home_address: string | null;
  emergency_contact: string | null;
  emergency_phone: string | null;
  mobility_type: 'standard' | 'wheelchair' | 'stretcher' | 'bariatric';
  dispatcher_notes: string | null;
  insurance_id: string | null;
  insurance_name: string | null;
  is_active: boolean;
  created_at: string;
}

interface RidersResponse {
  data: Rider[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const MOBILITY_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  standard: { label: 'Standard', color: 'bg-gray-100 text-gray-700', icon: '🚗' },
  wheelchair: { label: 'Wheelchair', color: 'bg-blue-100 text-blue-800', icon: '♿' },
  stretcher: { label: 'Stretcher', color: 'bg-orange-100 text-orange-800', icon: '🛏️' },
  bariatric: { label: 'Bariatric', color: 'bg-purple-100 text-purple-800', icon: '🚐' },
};

const EMPTY_FORM = {
  name: '',
  phone: '',
  phone_alt: '',
  email: '',
  home_address: '',
  emergency_contact: '',
  emergency_phone: '',
  mobility_type: 'standard',
  dispatcher_notes: '',
  insurance_id: '',
  insurance_name: '',
};

export function Riders() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editRider, setEditRider] = useState<Rider | null>(null);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const { data, isLoading } = useQuery<RidersResponse>({
    queryKey: ['riders', page, search],
    queryFn: () =>
      api.get('/api/riders', { params: { page, limit: 25, search } }).then(r => r.data),
  });

  const createRider = useMutation({
    mutationFn: (body: typeof EMPTY_FORM) => api.post('/api/riders', body).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['riders'] });
      queryClient.invalidateQueries({ queryKey: ['riders-all'] });
      setShowAdd(false);
      setForm(EMPTY_FORM);
    },
  });

  const updateRider = useMutation({
    mutationFn: ({ id, body }: { id: number; body: typeof EMPTY_FORM }) =>
      api.put(`/api/riders/${id}`, body).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['riders'] });
      setEditRider(null);
    },
  });

  const archiveRider = useMutation({
    mutationFn: (id: number) => api.delete(`/api/riders/${id}`).then(r => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['riders'] }),
  });

  const openEdit = (rider: Rider) => {
    setEditRider(rider);
    setForm({
      name: rider.name,
      phone: rider.phone,
      phone_alt: rider.phone_alt ?? '',
      email: rider.email ?? '',
      home_address: rider.home_address ?? '',
      emergency_contact: rider.emergency_contact ?? '',
      emergency_phone: rider.emergency_phone ?? '',
      mobility_type: rider.mobility_type,
      dispatcher_notes: rider.dispatcher_notes ?? '',
      insurance_id: rider.insurance_id ?? '',
      insurance_name: rider.insurance_name ?? '',
    });
    setOpenMenuId(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editRider) {
      updateRider.mutate({ id: editRider.id, body: form });
    } else {
      createRider.mutate(form);
    }
  };

  const closeForm = () => {
    setShowAdd(false);
    setEditRider(null);
    setForm(EMPTY_FORM);
    createRider.reset();
    updateRider.reset();
  };

  const showForm = showAdd || editRider !== null;
  const mutError = (createRider.error || updateRider.error) as Error | null;
  const mutPending = createRider.isPending || updateRider.isPending;

  return (
    <div className="p-6">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Riders</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {data?.total ?? 0} registered riders
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-2 border border-gray-300 text-gray-700 rounded-lg px-3 py-2 text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            <Upload className="w-4 h-4" />
            Import CSV
          </button>
          <button
            onClick={() => { setShowAdd(true); setEditRider(null); setForm(EMPTY_FORM); }}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-2 text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Rider
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search by name or phone…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <div className="animate-pulse space-y-3 w-full px-6">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-10 bg-gray-100 rounded" />
              ))}
            </div>
          </div>
        ) : data?.data.length === 0 ? (
          <div className="text-center py-16">
            <User className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No riders found</p>
            <p className="text-sm text-gray-400 mt-1">Add riders manually or import a CSV</p>
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-5 py-3 font-medium text-gray-600">Name</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-600 hidden md:table-cell">Phone</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-600 hidden lg:table-cell">Address</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-600">Mobility</th>
                  <th className="text-left px-5 py-3 font-medium text-gray-600 hidden xl:table-cell">Insurance</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {data?.data.map(rider => {
                  const mob = MOBILITY_LABELS[rider.mobility_type] ?? MOBILITY_LABELS.standard;
                  return (
                    <tr key={rider.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3">
                        <p className="font-medium text-gray-900">{rider.name}</p>
                        {rider.dispatcher_notes && (
                          <p className="text-xs text-gray-400 truncate max-w-xs">{rider.dispatcher_notes}</p>
                        )}
                      </td>
                      <td className="px-5 py-3 hidden md:table-cell">
                        <a href={`tel:${rider.phone}`} className="flex items-center gap-1 text-blue-600 hover:underline">
                          <Phone className="w-3 h-3" />
                          {rider.phone}
                        </a>
                      </td>
                      <td className="px-5 py-3 hidden lg:table-cell text-gray-500">
                        {rider.home_address ? (
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3 h-3 shrink-0" />
                            <span className="truncate max-w-xs">{rider.home_address}</span>
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${mob.color}`}>
                          {mob.icon} {mob.label}
                        </span>
                      </td>
                      <td className="px-5 py-3 hidden xl:table-cell">
                        {rider.insurance_name ? (
                          <div>
                            <p className="text-xs font-medium text-gray-700">{rider.insurance_name}</p>
                            {rider.insurance_id && (
                              <p className="text-xs text-gray-400 font-mono">{rider.insurance_id}</p>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 relative">
                        <button
                          onClick={() => setOpenMenuId(openMenuId === rider.id ? null : rider.id)}
                          className="p-1 rounded hover:bg-gray-200 transition-colors"
                          aria-label="Actions"
                        >
                          <MoreHorizontal className="w-4 h-4 text-gray-500" />
                        </button>
                        {openMenuId === rider.id && (
                          <div className="absolute right-4 top-10 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-10 min-w-36">
                            <button
                              onClick={() => openEdit(rider)}
                              className="flex items-center gap-2 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              Edit
                            </button>
                            <button
                              onClick={() => { archiveRider.mutate(rider.id); setOpenMenuId(null); }}
                              className="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                            >
                              <Archive className="w-3.5 h-3.5" />
                              Archive
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Pagination */}
            {data && data.totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50">
                <p className="text-sm text-gray-500">
                  Page {data.page} of {data.totalPages} · {data.total} riders
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="p-1.5 rounded-lg border border-gray-300 hover:bg-white disabled:opacity-40 transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setPage(p => Math.min(data.totalPages, p + 1))}
                    disabled={page === data.totalPages}
                    className="p-1.5 rounded-lg border border-gray-300 hover:bg-white disabled:opacity-40 transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Add / Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b">
              <h2 className="text-lg font-bold text-gray-900">{editRider ? 'Edit Rider' : 'Add New Rider'}</h2>
              <button onClick={closeForm} className="p-1 rounded-full hover:bg-gray-100" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              {/* Name + Phone row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
                  <input
                    required
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Maria Rodriguez"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone *</label>
                  <input
                    required
                    type="tel"
                    value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    placeholder="+15551234567"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Home Address</label>
                <input
                  value={form.home_address}
                  onChange={e => setForm(f => ({ ...f, home_address: e.target.value }))}
                  placeholder="123 Main St, Springfield IL 62701"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mobility Requirements</label>
                <select
                  value={form.mobility_type}
                  onChange={e => setForm(f => ({ ...f, mobility_type: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="standard">🚗 Standard</option>
                  <option value="wheelchair">♿ Wheelchair</option>
                  <option value="stretcher">🛏️ Stretcher</option>
                  <option value="bariatric">🚐 Bariatric</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Alt. Phone</label>
                  <input
                    type="tel"
                    value={form.phone_alt}
                    onChange={e => setForm(f => ({ ...f, phone_alt: e.target.value }))}
                    placeholder="+15559876543"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="rider@email.com"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Emergency Contact</label>
                  <input
                    value={form.emergency_contact}
                    onChange={e => setForm(f => ({ ...f, emergency_contact: e.target.value }))}
                    placeholder="Pedro Rodriguez"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Emergency Phone</label>
                  <input
                    type="tel"
                    value={form.emergency_phone}
                    onChange={e => setForm(f => ({ ...f, emergency_phone: e.target.value }))}
                    placeholder="+15559876543"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Insurance */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Insurance / Payer</label>
                  <input
                    value={form.insurance_name}
                    onChange={e => setForm(f => ({ ...f, insurance_name: e.target.value }))}
                    placeholder="Medicaid, Medicare…"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Member / Auth ID</label>
                  <input
                    value={form.insurance_id}
                    onChange={e => setForm(f => ({ ...f, insurance_id: e.target.value }))}
                    placeholder="1234567890A"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Dispatcher Notes</label>
                <textarea
                  rows={2}
                  value={form.dispatcher_notes}
                  onChange={e => setForm(f => ({ ...f, dispatcher_notes: e.target.value }))}
                  placeholder="Operational notes (e.g. prefers side entrance)…"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>

              {mutError && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{mutError.message}</p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeForm}
                  className="flex-1 border border-gray-300 text-gray-700 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" disabled={mutPending}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50 transition-colors">
                  {mutPending ? 'Saving…' : editRider ? 'Save Changes' : 'Add Rider'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CSV Import Modal */}
      {showImport && (
        <CSVImport
          onClose={() => setShowImport(false)}
          onComplete={() => queryClient.invalidateQueries({ queryKey: ['riders'] })}
        />
      )}
    </div>
  );
}

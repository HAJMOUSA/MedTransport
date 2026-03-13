import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { X } from 'lucide-react';

interface AddTripModalProps {
  onClose: () => void;
}

export function AddTripModal({ onClose }: AddTripModalProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    riderId: '',
    pickupAddress: '',
    dropoffAddress: '',
    scheduledPickupAt: '',
    mobilityType: 'standard',
    driverId: '',
    dispatcherNotes: '',
  });

  const { data: riders, isLoading: ridersLoading } = useQuery<{ data: Array<{ id: number; name: string; phone: string; mobility_type: string }> }>({
    queryKey: ['riders-all'],
    queryFn: () => api.get('/api/riders?limit=500').then(r => r.data),
  });

  const { data: drivers } = useQuery<Array<{ id: number; name: string; vehicle_name: string | null }>>({
    queryKey: ['drivers-all'],
    queryFn: () => api.get('/api/drivers').then(r => r.data),
  });

  const createTrip = useMutation({
    mutationFn: (data: typeof form) =>
      api.post('/api/trips', {
        ...data,
        riderId: parseInt(data.riderId),
        driverId: data.driverId ? parseInt(data.driverId) : undefined,
      }).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trips'] });
      onClose();
    },
  });

  const handleRiderChange = (riderId: string) => {
    const rider = riders?.data.find(r => r.id === parseInt(riderId));
    setForm(f => ({
      ...f,
      riderId,
      mobilityType: rider?.mobility_type ?? 'standard',
    }));
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label="Add New Trip">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-lg font-bold text-gray-900">Add New Trip</h2>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-100" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); createTrip.mutate(form); }}
          className="p-5 space-y-4"
        >
          {/* Rider */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="riderId">
              Rider *
            </label>
            <select
              id="riderId"
              required
              value={form.riderId}
              onChange={e => handleRiderChange(e.target.value)}
              disabled={ridersLoading}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
            >
              {ridersLoading
                ? <option value="">Loading riders…</option>
                : <option value="">Select rider…</option>
              }
              {riders?.data.map(r => (
                <option key={r.id} value={r.id}>{r.name} — {r.phone}</option>
              ))}
            </select>
            {!ridersLoading && riders?.data.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">
                No riders found. <a href="/riders" className="underline font-medium">Add a rider</a> first.
              </p>
            )}
          </div>

          {/* Pickup */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="pickupAddress">
              Pickup Address *
            </label>
            <input
              id="pickupAddress"
              type="text"
              required
              value={form.pickupAddress}
              onChange={e => setForm(f => ({ ...f, pickupAddress: e.target.value }))}
              placeholder="123 Main St, City, ST 12345"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Dropoff */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="dropoffAddress">
              Dropoff Address *
            </label>
            <input
              id="dropoffAddress"
              type="text"
              required
              value={form.dropoffAddress}
              onChange={e => setForm(f => ({ ...f, dropoffAddress: e.target.value }))}
              placeholder="456 Hospital Blvd, City, ST 12345"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Pickup time */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="scheduledPickupAt">
              Pickup Time *
            </label>
            <input
              id="scheduledPickupAt"
              type="datetime-local"
              required
              value={form.scheduledPickupAt}
              onChange={e => setForm(f => ({ ...f, scheduledPickupAt: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Mobility type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="mobilityType">
              Mobility Requirements
            </label>
            <select
              id="mobilityType"
              value={form.mobilityType}
              onChange={e => setForm(f => ({ ...f, mobilityType: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="standard">Standard</option>
              <option value="wheelchair">Wheelchair</option>
              <option value="stretcher">Stretcher</option>
              <option value="bariatric">Bariatric</option>
            </select>
          </div>

          {/* Assign driver (optional) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="driverId">
              Assign Driver (optional)
            </label>
            <select
              id="driverId"
              value={form.driverId}
              onChange={e => setForm(f => ({ ...f, driverId: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Unassigned</option>
              {drivers?.map(d => (
                <option key={d.id} value={d.id}>
                  {d.name}{d.vehicle_name ? ` — ${d.vehicle_name}` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="dispatcherNotes">
              Notes
            </label>
            <textarea
              id="dispatcherNotes"
              rows={2}
              value={form.dispatcherNotes}
              onChange={e => setForm(f => ({ ...f, dispatcherNotes: e.target.value }))}
              placeholder="Operational notes…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {createTrip.error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              {(createTrip.error as Error).message}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-300 text-gray-700 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={createTrip.isPending}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50 transition-colors">
              {createTrip.isPending ? 'Creating…' : 'Create Trip'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

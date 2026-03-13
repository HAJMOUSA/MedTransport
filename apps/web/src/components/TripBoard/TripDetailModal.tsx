import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { X, AlertCircle, User, Car } from 'lucide-react';
import type { Trip } from './TripBoard';

interface TripDetailModalProps {
  trip: Trip;
  onClose: () => void;
}

const EDITABLE_STATUSES = ['scheduled', 'dispatched'];

export function TripDetailModal({ trip, onClose }: TripDetailModalProps) {
  const queryClient = useQueryClient();
  const canEdit = EDITABLE_STATUSES.includes(trip.status);

  const [form, setForm] = useState({
    pickupAddress: trip.pickup_address,
    dropoffAddress: trip.dropoff_address,
    scheduledPickupAt: trip.scheduled_pickup_at
      ? new Date(trip.scheduled_pickup_at).toISOString().slice(0, 16)
      : '',
    mobilityType: trip.mobility_type,
    dispatcherNotes: '',
  });

  const [assignDriverId, setAssignDriverId] = useState<string>(
    trip.driver_id ? String(trip.driver_id) : ''
  );

  const { data: drivers } = useQuery<Array<{ id: number; name: string; vehicle_name: string | null }>>({
    queryKey: ['drivers-all'],
    queryFn: () => api.get('/api/drivers').then(r => r.data),
  });

  const updateTrip = useMutation({
    mutationFn: (data: typeof form) =>
      api.put(`/api/trips/${trip.id}`, data).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trips'] });
      onClose();
    },
  });

  const assignDriver = useMutation({
    mutationFn: (driverId: number) =>
      api.patch(`/api/trips/${trip.id}/assign`, { driverId }).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trips'] });
      onClose();
    },
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateTrip.mutate(form);
  };

  const handleAssign = () => {
    if (!assignDriverId) return;
    assignDriver.mutate(parseInt(assignDriverId, 10));
  };

  const error = updateTrip.error || assignDriver.error;
  const isPending = updateTrip.isPending || assignDriver.isPending;

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Trip Details"
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              Trip #{trip.id} — {trip.rider_name}
            </h2>
            <span className={`inline-block mt-1 text-xs font-medium px-2 py-0.5 rounded-full ${
              trip.status === 'completed' ? 'bg-green-100 text-green-700' :
              trip.status === 'cancelled' ? 'bg-gray-100 text-gray-600' :
              trip.status === 'dispatched' ? 'bg-blue-100 text-blue-700' :
              'bg-gray-100 text-gray-700'
            }`}>
              {trip.status.replace(/_/g, ' ')}
            </span>
          </div>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-100" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Assign Driver section */}
          <div className="bg-gray-50 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
              <User className="w-4 h-4" />
              Driver Assignment
            </h3>
            {trip.driver_name ? (
              <div className="flex items-center gap-2 text-sm text-gray-700 mb-3">
                <Car className="w-4 h-4 text-gray-400" />
                <span className="font-medium">{trip.driver_name}</span>
                {trip.vehicle_name && (
                  <span className="text-gray-400">— {trip.vehicle_name}</span>
                )}
              </div>
            ) : (
              <p className="text-sm text-amber-600 font-medium mb-3">⚠ Unassigned</p>
            )}
            {canEdit && (
              <div className="flex gap-2">
                <select
                  value={assignDriverId}
                  onChange={e => setAssignDriverId(e.target.value)}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select driver…</option>
                  {drivers?.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.name}{d.vehicle_name ? ` — ${d.vehicle_name}` : ''}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleAssign}
                  disabled={!assignDriverId || assignDriver.isPending}
                  className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-colors"
                >
                  {assignDriver.isPending ? 'Assigning…' : 'Assign'}
                </button>
              </div>
            )}
          </div>

          {/* Edit trip fields */}
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Pickup Address</label>
              <input
                type="text"
                value={form.pickupAddress}
                onChange={e => setForm(f => ({ ...f, pickupAddress: e.target.value }))}
                disabled={!canEdit}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Dropoff Address</label>
              <input
                type="text"
                value={form.dropoffAddress}
                onChange={e => setForm(f => ({ ...f, dropoffAddress: e.target.value }))}
                disabled={!canEdit}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Scheduled Pickup Time</label>
              <input
                type="datetime-local"
                value={form.scheduledPickupAt}
                onChange={e => setForm(f => ({ ...f, scheduledPickupAt: e.target.value }))}
                disabled={!canEdit}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mobility Requirements</label>
              <select
                value={form.mobilityType}
                onChange={e => setForm(f => ({ ...f, mobilityType: e.target.value }))}
                disabled={!canEdit}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
              >
                <option value="standard">Standard</option>
                <option value="wheelchair">Wheelchair</option>
                <option value="stretcher">Stretcher</option>
                <option value="bariatric">Bariatric</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Dispatcher Notes</label>
              <textarea
                rows={2}
                value={form.dispatcherNotes}
                onChange={e => setForm(f => ({ ...f, dispatcherNotes: e.target.value }))}
                disabled={!canEdit}
                placeholder="Operational notes…"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500 resize-none"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{(error as Error).message}</p>
              </div>
            )}

            {!canEdit && (
              <p className="text-xs text-gray-400 text-center">
                Trip cannot be edited once it is past the "dispatched" stage.
              </p>
            )}

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 border border-gray-300 text-gray-700 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50"
              >
                Close
              </button>
              {canEdit && (
                <button
                  type="submit"
                  disabled={isPending}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50 transition-colors"
                >
                  {updateTrip.isPending ? 'Saving…' : 'Save Changes'}
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

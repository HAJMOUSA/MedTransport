import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { TripCard } from './TripCard';
import { AddTripModal } from './AddTripModal';
import { TripDetailModal } from './TripDetailModal';
import { useSocket } from '../../hooks/useSocket';
import { Plus, Search, Filter } from 'lucide-react';
import { format } from 'date-fns';

const STATUS_COLUMNS = [
  { key: 'scheduled',         label: 'Scheduled',    color: 'bg-gray-100   text-gray-700' },
  { key: 'dispatched',        label: 'Dispatched',   color: 'bg-blue-100   text-blue-700' },
  { key: 'en_route_pickup',   label: 'En Route',     color: 'bg-indigo-100 text-indigo-700' },
  { key: 'arrived_pickup',    label: 'Arrived',      color: 'bg-yellow-100 text-yellow-700' },
  { key: 'picked_up',         label: 'Picked Up',    color: 'bg-orange-100 text-orange-700' },
  { key: 'en_route_dropoff',  label: 'To Dropoff',   color: 'bg-purple-100 text-purple-700' },
  { key: 'completed',         label: 'Completed',    color: 'bg-green-100  text-green-700' },
] as const;

export interface Trip {
  id: number;
  status: string;
  rider_name: string;
  rider_phone: string;
  driver_name: string | null;
  driver_id: number | null;
  pickup_address: string;
  dropoff_address: string;
  scheduled_pickup_at: string;
  actual_pickup_at: string | null;
  mobility_type: string;
  vehicle_name: string | null;
}

export function TripBoard() {
  const socket = useSocket();
  const queryClient = useQueryClient();
  const [showAddTrip, setShowAddTrip] = useState(false);
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('');

  const { data, isLoading } = useQuery<{ data: Trip[] }>({
    queryKey: ['trips', dateFilter],
    queryFn: () => api.get(`/api/trips?${dateFilter ? `date=${dateFilter}&` : ''}limit=200`).then(r => r.data),
    refetchInterval: 60_000,
  });

  // Real-time trip status updates
  useEffect(() => {
    if (!socket) return;

    const handleStatusChange = () => {
      queryClient.invalidateQueries({ queryKey: ['trips'] });
    };

    socket.on('trip:status-changed', handleStatusChange);
    socket.on('trip:created', handleStatusChange);
    socket.on('trip:assigned', handleStatusChange);
    socket.on('trip:otp-verified', handleStatusChange);

    return () => {
      socket.off('trip:status-changed', handleStatusChange);
      socket.off('trip:created', handleStatusChange);
      socket.off('trip:assigned', handleStatusChange);
      socket.off('trip:otp-verified', handleStatusChange);
    };
  }, [socket, queryClient]);

  const trips = data?.data ?? [];
  const filtered = search
    ? trips.filter(t =>
        t.rider_name.toLowerCase().includes(search.toLowerCase()) ||
        t.driver_name?.toLowerCase().includes(search.toLowerCase()) ||
        t.pickup_address.toLowerCase().includes(search.toLowerCase())
      )
    : trips;

  // Group by status
  const byStatus = STATUS_COLUMNS.reduce<Record<string, Trip[]>>((acc, col) => {
    acc[col.key] = filtered.filter(t => t.status === col.key);
    return acc;
  }, {});

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Trip Board</h1>
          <p className="text-sm text-gray-500">{trips.length} trips</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Date filter */}
          <div className="flex items-center gap-1">
            <input
              type="date"
              value={dateFilter}
              onChange={e => setDateFilter(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Filter by date"
            />
            {dateFilter && (
              <button
                onClick={() => setDateFilter('')}
                className="text-xs text-gray-400 hover:text-gray-600 px-1"
                title="Clear date filter"
              >✕</button>
            )}
          </div>
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" />
            <input
              type="search"
              placeholder="Search trips…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 pr-3 py-2 text-sm border border-gray-300 rounded-lg w-48 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Search trips"
            />
          </div>
          <button
            onClick={() => setShowAddTrip(true)}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            aria-label="Add new trip"
          >
            <Plus className="w-4 h-4" /> Add Trip
          </button>
        </div>
      </div>

      {/* Kanban columns */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center text-gray-400">Loading trips…</div>
      ) : (
        <div className="flex-1 overflow-x-auto">
          <div className="flex gap-4 pb-4 min-w-max">
            {STATUS_COLUMNS.map(col => (
              <div key={col.key} className="w-64 flex-shrink-0">
                <div className={`text-xs font-semibold uppercase tracking-wide px-2 py-1 rounded-md mb-2 ${col.color}`}>
                  {col.label} ({byStatus[col.key]?.length ?? 0})
                </div>
                <div className="space-y-2 min-h-[100px]">
                  {byStatus[col.key]?.map(trip => (
                    <TripCard key={trip.id} trip={trip} onClick={() => setSelectedTrip(trip)} />
                  ))}
                  {byStatus[col.key]?.length === 0 && (
                    <div className="text-xs text-gray-400 text-center py-4 border-2 border-dashed border-gray-200 rounded-lg">
                      No trips
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showAddTrip && <AddTripModal onClose={() => setShowAddTrip(false)} />}
      {selectedTrip && (
        <TripDetailModal trip={selectedTrip} onClose={() => setSelectedTrip(null)} />
      )}
    </div>
  );
}

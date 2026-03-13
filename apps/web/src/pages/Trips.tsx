import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { TripBoard } from '../components/TripBoard/TripBoard';
import { LiveMap } from '../components/LiveMap/LiveMap';
import { LayoutList, Map } from 'lucide-react';

type View = 'board' | 'map';

export function Trips() {
  const [view, setView] = useState<View>('board');

  // Fetch trips for map markers (only active when map is visible)
  const { data: tripsData } = useQuery({
    queryKey: ['trips-map'],
    queryFn: () => api.get('/api/trips?limit=200').then(r => r.data),
    enabled: view === 'map',
    refetchInterval: 30_000,
  });

  return (
    <div className="flex flex-col h-full">
      {/* Sub-nav */}
      <div className="flex items-center gap-1 px-6 pt-5 pb-0">
        <h1 className="text-2xl font-bold text-gray-900 mr-4">Trips</h1>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setView('board')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              view === 'board' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <LayoutList className="w-4 h-4" />
            Board
          </button>
          <button
            onClick={() => setView('map')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              view === 'map' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Map className="w-4 h-4" />
            Live Map
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {view === 'board'
          ? <TripBoard />
          : <LiveMap trips={tripsData?.data ?? []} />
        }
      </div>
    </div>
  );
}

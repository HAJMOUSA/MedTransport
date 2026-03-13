import { Clock, MapPin, User, Car, Phone } from 'lucide-react';
import { format } from 'date-fns';
import type { Trip } from './TripBoard';

const MOBILITY_ICONS: Record<string, string> = {
  standard: '🚗',
  wheelchair: '♿',
  stretcher: '🛏️',
  bariatric: '🚐',
};

interface TripCardProps {
  trip: Trip;
  onClick: () => void;
}

export function TripCard({ trip, onClick }: TripCardProps) {
  const pickupTime = new Date(trip.scheduled_pickup_at);
  const isLate = !trip.actual_pickup_at &&
    ['en_route_pickup', 'dispatched'].includes(trip.status) &&
    new Date() > pickupTime;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => e.key === 'Enter' && onClick()}
      className={`bg-white rounded-lg border shadow-sm p-3 cursor-pointer hover:shadow-md transition-shadow ${
        isLate ? 'border-red-300' : 'border-gray-200'
      }`}
    >
      {/* Rider + mobility */}
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-base">{MOBILITY_ICONS[trip.mobility_type] || '🚗'}</span>
            <span className="font-semibold text-gray-900 text-sm">{trip.rider_name}</span>
          </div>
          <a
            href={`tel:${trip.rider_phone}`}
            className="text-xs text-gray-400 flex items-center gap-0.5 hover:text-blue-600"
            onClick={e => e.stopPropagation()}
          >
            <Phone className="w-3 h-3" />{trip.rider_phone}
          </a>
        </div>
        {isLate && (
          <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium">Late</span>
        )}
      </div>

      {/* Time */}
      <div className="flex items-center gap-1.5 text-xs text-gray-600 mb-1.5">
        <Clock className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="font-medium">{format(pickupTime, 'h:mm a')}</span>
      </div>

      {/* Addresses */}
      <div className="space-y-0.5 text-xs text-gray-500">
        <div className="flex items-start gap-1.5">
          <MapPin className="w-3 h-3 text-blue-500 flex-shrink-0 mt-0.5" />
          <span className="truncate">{trip.pickup_address}</span>
        </div>
        <div className="flex items-start gap-1.5">
          <MapPin className="w-3 h-3 text-red-500 flex-shrink-0 mt-0.5" />
          <span className="truncate">{trip.dropoff_address}</span>
        </div>
      </div>

      {/* Driver */}
      {trip.driver_name && (
        <div className="flex items-center gap-1.5 text-xs text-gray-500 mt-2 pt-2 border-t border-gray-100">
          <User className="w-3 h-3" />
          <span>{trip.driver_name}</span>
          {trip.vehicle_name && (
            <>
              <Car className="w-3 h-3 ml-1" />
              <span>{trip.vehicle_name}</span>
            </>
          )}
        </div>
      )}

      {!trip.driver_name && (
        <div className="text-xs text-amber-600 font-medium mt-2 pt-2 border-t border-gray-100">
          ⚠ Unassigned
        </div>
      )}
    </div>
  );
}

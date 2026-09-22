// apps/mobile/src/hooks/useDriverProfile.ts
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

interface DriverProfile {
  id: number;
  on_shift: boolean;
  shift_started_at: string | null;
  vehicle_id: number | null;
}

export function useDriverProfile() {
  const { data, isLoading } = useQuery<DriverProfile>({
    queryKey: ['driver-me'],
    queryFn: () => api.get('/api/drivers/me').then(r => r.data),
    staleTime: 60_000,
  });
  return { driverId: data?.id, onShift: data?.on_shift ?? false, isLoading };
}

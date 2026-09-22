// ─── Nominatim geocoding (OpenStreetMap — free, no API key) ──────────────────
export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MidTransport/1.0 (nemt-dispatch)' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const results = await res.json() as Array<{ lat: string; lon: string }>;
    if (!results.length) return null;
    return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
  } catch {
    return null; // Geocoding failure is non-fatal — trip still saves
  }
}

export interface AddressSuggestion {
  display: string; lat: number; lng: number;
  street: string; city: string; state: string; zip: string;
}

export async function searchAddresses(q: string, limit = 5): Promise<AddressSuggestion[]> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&addressdetails=1&countrycodes=us&limit=${limit}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MidTransport/1.0 (nemt-dispatch)' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const results = await res.json() as Array<{
      display_name: string; lat: string; lon: string;
      address?: { house_number?: string; road?: string; city?: string; town?: string; village?: string; state?: string; postcode?: string };
    }>;
    return results.map(r => ({
      display: r.display_name,
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lon),
      street: [r.address?.house_number, r.address?.road].filter(Boolean).join(' '),
      city: r.address?.city ?? r.address?.town ?? r.address?.village ?? '',
      state: r.address?.state ?? '',
      zip: r.address?.postcode ?? '',
    }));
  } catch {
    return [];
  }
}

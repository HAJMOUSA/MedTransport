import { Linking, Platform } from 'react-native';

interface Destination {
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
}

export async function openNavigation(dest: Destination): Promise<void> {
  const hasCoords = dest.lat != null && dest.lng != null;
  if (!hasCoords && !dest.address) return;

  const q = hasCoords
    ? `${dest.lat},${dest.lng}`
    : encodeURIComponent(dest.address ?? '');

  // NOTE: iOS requires `comgooglemaps` in app.json ios.infoPlist.LSApplicationQueriesSchemes
  // for canOpenURL to detect Google Maps. Android 11+ (API 30+) package-visibility filtering
  // may make canOpenURL('google.navigation:...') return false without a <queries> entry
  // (needs an Expo config plugin); the geo: candidate and the https fallback still open a map.
  const candidates =
    Platform.OS === 'ios'
      ? [`comgooglemaps://?daddr=${q}&directionsmode=driving`, `https://maps.apple.com/?daddr=${q}`]
      : [`google.navigation:q=${q}`, `geo:0,0?q=${q}`];

  const webFallback = `https://www.google.com/maps/dir/?api=1&destination=${q}`;

  for (const url of candidates) {
    try {
      if (await Linking.canOpenURL(url)) {
        await Linking.openURL(url);
        return;
      }
    } catch {
      // try next candidate
    }
  }
  await Linking.openURL(webFallback);
}

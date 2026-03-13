import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Alert,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSocket } from '../hooks/useSocket';
import { api } from '../lib/api';

interface TripDetail {
  id: number;
  rider_name: string;
  rider_phone: string;
  pickup_address: string;
  dropoff_address: string;
  scheduled_pickup_at: string;
  status: string;
  mobility_type: string;
  dispatcher_notes: string | null;
  driver_name: string | null;
  vehicle_name: string | null;
}

const NEXT_STATUS: Record<string, { label: string; next: string; color: string }> = {
  dispatched:      { label: '▶  Start Trip',          next: 'en_route_pickup',   color: '#3b82f6' },
  en_route_pickup: { label: '📍 Arrived at Pickup',   next: 'arrived_pickup',    color: '#8b5cf6' },
  arrived_pickup:  { label: '✅ Picked Up — Enter OTP', next: 'picked_up',        color: '#f59e0b' },
  picked_up:       { label: '▶  En Route to Dropoff', next: 'en_route_dropoff',   color: '#10b981' },
  en_route_dropoff:{ label: '📍 Arrived at Dropoff',  next: 'arrived_dropoff',   color: '#8b5cf6' },
  arrived_dropoff: { label: '✅ Complete — Enter OTP', next: 'completed',          color: '#f59e0b' },
};

const GPS_INTERVAL_MS = 10_000; // 10 seconds

export function ActiveTrip({ route, navigation }: { route: any; navigation: any }) {
  const { tripId } = route.params;
  const queryClient = useQueryClient();
  const socketRef = useSocket();
  const locationSub = useRef<Location.LocationSubscription | null>(null);
  const [speed, setSpeed] = useState<number | null>(null);
  const [locationAllowed, setLocationAllowed] = useState(false);

  const { data: trip, isLoading } = useQuery<TripDetail>({
    queryKey: ['trip', tripId],
    queryFn: () => api.get(`/api/trips/${tripId}`).then(r => r.data),
    refetchInterval: 15_000,
  });

  // Start GPS tracking
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Location Required',
          'Please enable location access so the dispatcher can track your trip.',
          [{ text: 'OK' }]
        );
        return;
      }
      setLocationAllowed(true);

      // Subscribe to location updates
      locationSub.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: GPS_INTERVAL_MS,
          distanceInterval: 20, // meters
        },
        (loc) => {
          const socket = socketRef.current;
          if (!socket?.connected) return;
          setSpeed(loc.coords.speed ? Math.round(loc.coords.speed * 2.237) : 0); // m/s → mph
          socket.emit('driver:location-update', {
            tripId,
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            speedMph: loc.coords.speed ? loc.coords.speed * 2.237 : 0,
            headingDeg: loc.coords.heading ?? 0,
            accuracyM: Math.round(loc.coords.accuracy ?? 0),
          });
        }
      );
    })();

    return () => {
      locationSub.current?.remove();
    };
  }, [tripId, socketRef]);

  // Listen for OTP-sent event
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    const handler = ({ tripId: tid, eventType }: { tripId: number; eventType: string }) => {
      if (tid === tripId) {
        navigation.navigate('OTPEntry', { tripId, eventType });
        queryClient.invalidateQueries({ queryKey: ['trip', tripId] });
      }
    };
    socket.on('trip:otp-sent', handler);
    return () => { socket.off('trip:otp-sent', handler); };
  }, [tripId, navigation, queryClient, socketRef]);

  const updateStatus = useMutation({
    mutationFn: (status: string) =>
      api.patch(`/api/trips/${tripId}/status`, { status }).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trip', tripId] });
      queryClient.invalidateQueries({ queryKey: ['my-trips'] });
    },
    onError: (err: Error) => {
      Alert.alert('Error', err.message);
    },
  });

  const handleStatusButton = () => {
    if (!trip) return;
    const action = NEXT_STATUS[trip.status];
    if (!action) return;

    // OTP transitions — navigate to OTP screen first
    if (trip.status === 'arrived_pickup') {
      navigation.navigate('OTPEntry', { tripId, eventType: 'pickup' });
      return;
    }
    if (trip.status === 'arrived_dropoff') {
      navigation.navigate('OTPEntry', { tripId, eventType: 'dropoff' });
      return;
    }

    updateStatus.mutate(action.next);
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color="#2563eb" />
      </SafeAreaView>
    );
  }

  if (!trip) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.errorText}>Trip not found</Text>
      </SafeAreaView>
    );
  }

  const action = NEXT_STATUS[trip.status];
  const isDone = trip.status === 'completed' || trip.status === 'cancelled';
  const scheduledTime = new Date(trip.scheduled_pickup_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{trip.rider_name}</Text>
          {speed !== null && (
            <Text style={styles.speedBadge}>🚗 {speed} mph</Text>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Rider info card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Rider</Text>
          <Text style={styles.riderName}>{trip.rider_name}</Text>
          <TouchableOpacity
            onPress={() => Linking.openURL(`tel:${trip.rider_phone}`)}
            style={styles.phoneRow}
          >
            <Text style={styles.phoneText}>📞 {trip.rider_phone}</Text>
          </TouchableOpacity>
          {trip.mobility_type !== 'standard' && (
            <View style={styles.mobilityTag}>
              <Text style={styles.mobilityTagText}>
                {trip.mobility_type === 'wheelchair' ? '♿ Wheelchair' :
                 trip.mobility_type === 'stretcher' ? '🛏️ Stretcher' : '🚐 Bariatric'}
              </Text>
            </View>
          )}
          {trip.dispatcher_notes && (
            <Text style={styles.notes}>📋 {trip.dispatcher_notes}</Text>
          )}
        </View>

        {/* Pickup */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Pickup · {scheduledTime}</Text>
          <Text style={styles.addressText}>{trip.pickup_address}</Text>
          <TouchableOpacity
            onPress={() => Linking.openURL(
              `https://maps.google.com/?q=${encodeURIComponent(trip.pickup_address)}`
            )}
            style={[styles.navBtn, { backgroundColor: '#eff6ff' }]}
          >
            <Text style={[styles.navBtnText, { color: '#2563eb' }]}>🗺  Navigate to Pickup</Text>
          </TouchableOpacity>
        </View>

        {/* Dropoff */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Dropoff</Text>
          <Text style={styles.addressText}>{trip.dropoff_address}</Text>
          <TouchableOpacity
            onPress={() => Linking.openURL(
              `https://maps.google.com/?q=${encodeURIComponent(trip.dropoff_address)}`
            )}
            style={[styles.navBtn, { backgroundColor: '#f0fdf4' }]}
          >
            <Text style={[styles.navBtnText, { color: '#16a34a' }]}>🗺  Navigate to Dropoff</Text>
          </TouchableOpacity>
        </View>

        {/* GPS warning */}
        {!locationAllowed && (
          <View style={styles.warningCard}>
            <Text style={styles.warningText}>
              ⚠️ Location permission denied. Enable it in Settings so the dispatcher can track this trip.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Action button */}
      {!isDone && action && (
        <View style={styles.actionBar}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: action.color }, updateStatus.isPending && styles.actionBtnDisabled]}
            onPress={handleStatusButton}
            disabled={updateStatus.isPending}
            activeOpacity={0.8}
          >
            {updateStatus.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.actionBtnText}>{action.label}</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {isDone && (
        <View style={styles.actionBar}>
          <View style={styles.completedBadge}>
            <Text style={styles.completedText}>✅ Trip Completed</Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontSize: 16, color: '#6b7280' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  backBtn: { paddingVertical: 4, paddingRight: 12 },
  backText: { fontSize: 15, color: '#2563eb', fontWeight: '500' },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#111827' },
  speedBadge: { fontSize: 13, color: '#6b7280', fontWeight: '500' },
  content: { padding: 16, gap: 12 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    gap: 8,
  },
  cardTitle: { fontSize: 12, fontWeight: '600', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5 },
  riderName: { fontSize: 20, fontWeight: '700', color: '#111827' },
  phoneRow: { paddingVertical: 2 },
  phoneText: { fontSize: 15, color: '#2563eb', fontWeight: '500' },
  mobilityTag: {
    alignSelf: 'flex-start',
    backgroundColor: '#dbeafe',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  mobilityTagText: { fontSize: 13, color: '#1d4ed8', fontWeight: '600' },
  notes: { fontSize: 13, color: '#6b7280', fontStyle: 'italic', marginTop: 4 },
  addressText: { fontSize: 15, color: '#374151', lineHeight: 22 },
  navBtn: {
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  navBtnText: { fontSize: 15, fontWeight: '600' },
  warningCard: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fcd34d',
    borderRadius: 12,
    padding: 12,
  },
  warningText: { fontSize: 13, color: '#92400e' },
  actionBar: {
    padding: 16,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  actionBtn: {
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
  },
  actionBtnDisabled: { opacity: 0.6 },
  actionBtnText: { fontSize: 17, fontWeight: '700', color: '#fff' },
  completedBadge: {
    backgroundColor: '#f0fdf4',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  completedText: { fontSize: 17, fontWeight: '700', color: '#15803d' },
});

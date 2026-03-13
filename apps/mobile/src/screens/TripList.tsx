import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Alert,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../hooks/useAuth';
import { useSocket } from '../hooks/useSocket';
import { api } from '../lib/api';

interface Trip {
  id: number;
  rider_name: string;
  rider_phone: string;
  pickup_address: string;
  dropoff_address: string;
  scheduled_pickup_at: string;
  status: string;
  mobility_type: string;
  dispatcher_notes: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  scheduled: '#6b7280',
  dispatched: '#3b82f6',
  en_route_pickup: '#8b5cf6',
  arrived_pickup: '#f59e0b',
  picked_up: '#10b981',
  en_route_dropoff: '#8b5cf6',
  arrived_dropoff: '#f59e0b',
  completed: '#22c55e',
};

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Scheduled',
  dispatched: 'Dispatched',
  en_route_pickup: 'En Route to Pickup',
  arrived_pickup: 'Arrived at Pickup',
  picked_up: 'Picked Up',
  en_route_dropoff: 'En Route to Dropoff',
  arrived_dropoff: 'Arrived at Dropoff',
  completed: 'Completed',
};

const MOBILITY_ICONS: Record<string, string> = {
  standard: '🚗',
  wheelchair: '♿',
  stretcher: '🛏️',
  bariatric: '🚐',
};

export function TripList({ navigation }: { navigation: any }) {
  const queryClient = useQueryClient();
  const { user, logout } = useAuthStore();
  const socketRef = useSocket();
  const [onShift, setOnShift] = useState(false);
  const [shiftLoading, setShiftLoading] = useState(false);

  const { data: trips = [], isLoading, refetch, isRefetching } = useQuery<Trip[]>({
    queryKey: ['my-trips'],
    queryFn: () => api.get('/api/trips').then(r => r.data),
  });

  // Listen for real-time trip assignments
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    const handler = () => queryClient.invalidateQueries({ queryKey: ['my-trips'] });
    socket.on('trip:assigned', handler);
    socket.on('trip:status-changed', handler);
    return () => {
      socket.off('trip:assigned', handler);
      socket.off('trip:status-changed', handler);
    };
  }, [queryClient, socketRef]);

  const toggleShift = useCallback(async () => {
    const socket = socketRef.current;
    if (!socket) return;
    setShiftLoading(true);
    if (!onShift) {
      socket.emit('driver:start-shift');
      setOnShift(true);
    } else {
      socket.emit('driver:end-shift');
      setOnShift(false);
    }
    setShiftLoading(false);
  }, [onShift, socketRef]);

  const activeTripStatuses = ['dispatched', 'en_route_pickup', 'arrived_pickup', 'picked_up', 'en_route_dropoff', 'arrived_dropoff'];
  const activeTrips = trips.filter(t => activeTripStatuses.includes(t.status));
  const scheduledTrips = trips.filter(t => t.status === 'scheduled');
  const completedTrips = trips.filter(t => t.status === 'completed');

  const renderTrip = ({ item }: { item: Trip }) => {
    const isActive = activeTripStatuses.includes(item.status);
    const time = new Date(item.scheduled_pickup_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return (
      <TouchableOpacity
        style={[styles.tripCard, isActive && styles.tripCardActive]}
        onPress={() => navigation.navigate('ActiveTrip', { tripId: item.id })}
        activeOpacity={0.7}
      >
        <View style={styles.tripCardHeader}>
          <View style={styles.tripCardLeft}>
            <Text style={styles.mobilityIcon}>{MOBILITY_ICONS[item.mobility_type] ?? '🚗'}</Text>
            <View>
              <Text style={styles.riderName}>{item.rider_name}</Text>
              <Text style={styles.tripTime}>{time}</Text>
            </View>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[item.status] + '20' }]}>
            <Text style={[styles.statusText, { color: STATUS_COLORS[item.status] }]}>
              {STATUS_LABELS[item.status] ?? item.status}
            </Text>
          </View>
        </View>

        <View style={styles.addresses}>
          <View style={styles.addressRow}>
            <View style={styles.dotBlue} />
            <Text style={styles.addressText} numberOfLines={1}>{item.pickup_address}</Text>
          </View>
          <View style={styles.addressLine} />
          <View style={styles.addressRow}>
            <View style={styles.dotRed} />
            <Text style={styles.addressText} numberOfLines={1}>{item.dropoff_address}</Text>
          </View>
        </View>

        {item.dispatcher_notes && (
          <Text style={styles.notes} numberOfLines={2}>📋 {item.dispatcher_notes}</Text>
        )}
      </TouchableOpacity>
    );
  };

  const sections = [
    ...(activeTrips.length > 0 ? [{ title: `Active (${activeTrips.length})`, data: activeTrips }] : []),
    ...(scheduledTrips.length > 0 ? [{ title: `Upcoming (${scheduledTrips.length})`, data: scheduledTrips }] : []),
    ...(completedTrips.length > 0 ? [{ title: `Completed Today (${completedTrips.length})`, data: completedTrips }] : []),
  ];

  const allTrips = sections.flatMap(s => [
    { type: 'header' as const, title: s.title, id: `h-${s.title}` },
    ...s.data.map(t => ({ type: 'trip' as const, ...t, id: String(t.id) })),
  ]);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>My Trips</Text>
          <Text style={styles.headerSub}>{user?.name}</Text>
        </View>
        <View style={styles.shiftToggle}>
          {shiftLoading ? (
            <ActivityIndicator size="small" color="#2563eb" />
          ) : (
            <>
              <Text style={[styles.shiftLabel, onShift && styles.shiftLabelActive]}>
                {onShift ? 'On Shift' : 'Off Shift'}
              </Text>
              <Switch
                value={onShift}
                onValueChange={toggleShift}
                trackColor={{ false: '#d1d5db', true: '#3b82f6' }}
                thumbColor={onShift ? '#fff' : '#f3f4f6'}
              />
            </>
          )}
        </View>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#2563eb" />
        </View>
      ) : allTrips.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>🚐</Text>
          <Text style={styles.emptyTitle}>No trips assigned</Text>
          <Text style={styles.emptySubtitle}>Your dispatcher will assign trips here</Text>
        </View>
      ) : (
        <FlatList
          data={allTrips}
          keyExtractor={item => item.id}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#2563eb" />}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            if (item.type === 'header') {
              return <Text style={styles.sectionHeader}>{item.title}</Text>;
            }
            return renderTrip({ item: item as Trip });
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#111827' },
  headerSub: { fontSize: 13, color: '#6b7280', marginTop: 1 },
  shiftToggle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  shiftLabel: { fontSize: 13, color: '#6b7280', fontWeight: '500' },
  shiftLabelActive: { color: '#2563eb' },
  list: { padding: 16, gap: 12 },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 8,
    marginBottom: 4,
  },
  tripCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    gap: 12,
  },
  tripCardActive: {
    borderColor: '#3b82f6',
    borderWidth: 1.5,
  },
  tripCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tripCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mobilityIcon: { fontSize: 24 },
  riderName: { fontSize: 15, fontWeight: '600', color: '#111827' },
  tripTime: { fontSize: 13, color: '#6b7280', marginTop: 1 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  statusText: { fontSize: 11, fontWeight: '600' },
  addresses: { gap: 4 },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dotBlue: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#3b82f6' },
  dotRed: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ef4444' },
  addressLine: { width: 2, height: 8, backgroundColor: '#d1d5db', marginLeft: 3 },
  addressText: { flex: 1, fontSize: 13, color: '#374151' },
  notes: { fontSize: 12, color: '#6b7280', fontStyle: 'italic' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyIcon: { fontSize: 48, marginBottom: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#374151' },
  emptySubtitle: { fontSize: 14, color: '#9ca3af' },
});

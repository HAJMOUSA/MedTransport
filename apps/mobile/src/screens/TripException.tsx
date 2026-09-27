import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput, Alert, ActivityIndicator, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { NO_SHOW_REASONS, CANCELLATION_REASONS } from '../lib/reasonCodes';

export function TripException({ route, navigation }: { route: any; navigation: any }) {
  const { tripId, mode } = route.params as { tripId: number; mode: 'no_show' | 'cancellation' };
  const queryClient = useQueryClient();
  const reasons = mode === 'no_show' ? NO_SHOW_REASONS : CANCELLATION_REASONS;
  const [reasonCode, setReasonCode] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const submit = useMutation({
    mutationFn: async () => {
      const endpoint = mode === 'no_show' ? 'no-show' : 'cancellation';
      await api.post(`/api/trips/${tripId}/${endpoint}`, {
        reasonCode, note: note.trim() || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trip', tripId] });
      queryClient.invalidateQueries({ queryKey: ['my-trips'] });
      navigation.navigate('Main');
    },
    onError: () => Alert.alert('Failed', 'Could not submit. Please try again.'),
  });

  const title = mode === 'no_show' ? 'Report No-Show' : 'Cancel Trip';

  const confirm = () => {
    if (!reasonCode) { Alert.alert('Select a reason', 'Please choose a reason.'); return; }
    Alert.alert(title, 'Are you sure? This cannot be undone.', [
      { text: 'Back', style: 'cancel' },
      { text: 'Confirm', style: 'destructive', onPress: () => submit.mutate() },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.label}>Reason</Text>
        {reasons.map((r) => (
          <TouchableOpacity
            key={r.code}
            style={[styles.reason, reasonCode === r.code && styles.reasonSelected]}
            onPress={() => setReasonCode(r.code)}
          >
            <Text style={[styles.reasonText, reasonCode === r.code && styles.reasonTextSelected]}>
              {r.label}
            </Text>
          </TouchableOpacity>
        ))}

        <Text style={styles.label}>Note (optional)</Text>
        <TextInput
          style={styles.input}
          value={note}
          onChangeText={setNote}
          placeholder="Add any details…"
          multiline
          maxLength={1000}
        />

        <TouchableOpacity
          style={[styles.submitBtn, submit.isPending && { opacity: 0.6 }]}
          onPress={confirm}
          disabled={submit.isPending}
        >
          {submit.isPending
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.submitText}>{title}</Text>}
        </TouchableOpacity>

        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  title: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: '#374151', marginTop: 16, marginBottom: 8 },
  reason: {
    borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10,
    paddingVertical: 14, paddingHorizontal: 14, marginBottom: 8,
  },
  reasonSelected: { borderColor: '#2563eb', backgroundColor: '#eff6ff' },
  reasonText: { fontSize: 15, color: '#374151' },
  reasonTextSelected: { color: '#2563eb', fontWeight: '600' },
  input: {
    borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, padding: 12,
    minHeight: 80, textAlignVertical: 'top', fontSize: 15,
  },
  submitBtn: {
    backgroundColor: '#dc2626', borderRadius: 10, paddingVertical: 16,
    alignItems: 'center', marginTop: 24,
  },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  backBtn: { alignItems: 'center', paddingVertical: 16 },
  backText: { color: '#6b7280', fontSize: 15 },
});

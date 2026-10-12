import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import SignatureScreen, { SignatureViewRef } from 'react-native-signature-canvas';
import * as Location from 'expo-location';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { api } from '../lib/api';

export function SignatureCapture({ route, navigation }: { route: any; navigation: any }) {
  const { tripId } = route.params as { tripId: number };
  const ref = useRef<SignatureViewRef>(null);
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);

  const submit = useMutation({
    mutationFn: async (signatureDataUrl: string) => {
      // signatureDataUrl is a "data:image/png;base64,...." URL — sent as-is; the
      // server strips the prefix, decodes, and stores the PNG.
      let lat: number | undefined;
      let lng: number | undefined;
      try {
        const loc = await Location.getLastKnownPositionAsync();
        if (loc) { lat = loc.coords.latitude; lng = loc.coords.longitude; }
      } catch { /* location optional */ }

      // Signature must be saved before completing — the status gate depends on it.
      await api.post(`/api/trips/${tripId}/signature`, {
        imageBase64: signatureDataUrl, lat, lng,
      });
      await api.patch(`/api/trips/${tripId}/status`, { status: 'completed' });
    },
    onSuccess: () => {
      setSubmitting(false);
      queryClient.invalidateQueries({ queryKey: ['trip', tripId] });
      queryClient.invalidateQueries({ queryKey: ['my-trips'] });
      navigation.navigate('Main');
    },
    onError: (err: unknown) => {
      setSubmitting(false);
      const alreadyComplete = err instanceof AxiosError && err.response?.status === 409;
      Alert.alert(
        'Save failed',
        alreadyComplete
          ? 'This trip is already completed. Please check with your dispatcher.'
          : 'Could not save the signature. Please try again.'
      );
    },
  });

  const handleConfirm = () => {
    setSubmitting(true);
    ref.current?.readSignature(); // fires onOK with the base64 data URL
  };

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={() => navigation.goBack()} disabled={submitting}>
        <Text style={styles.back}>‹ Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Rider / attendant signature</Text>
      <Text style={styles.subtitle}>Required to complete the trip</Text>

      <View style={styles.pad}>
        <SignatureScreen
          ref={ref}
          onOK={(sig) => submit.mutate(sig)}
          onEmpty={() => {
            setSubmitting(false);
            Alert.alert('No signature', 'Please capture a signature before confirming.');
          }}
          webStyle={`.m-signature-pad--footer { display: none; }`}
          autoClear={false}
        />
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.btn, styles.clearBtn]}
          onPress={() => ref.current?.clearSignature()}
          disabled={submitting}
        >
          <Text style={styles.clearText}>Clear</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, styles.confirmBtn, submitting && { opacity: 0.6 }]}
          onPress={handleConfirm}
          disabled={submitting}
        >
          {submitting
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.confirmText}>Confirm & Complete</Text>}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 16 },
  back: { color: '#2563eb', fontSize: 16, fontWeight: '600', marginBottom: 8 },
  title: { fontSize: 18, fontWeight: '700', color: '#111827' },
  subtitle: { fontSize: 13, color: '#6b7280', marginBottom: 12 },
  pad: { flex: 1, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, overflow: 'hidden' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  btn: { flex: 1, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  clearBtn: { backgroundColor: '#f3f4f6' },
  clearText: { color: '#374151', fontWeight: '600', fontSize: 15 },
  confirmBtn: { backgroundColor: '#10b981' },
  confirmText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});

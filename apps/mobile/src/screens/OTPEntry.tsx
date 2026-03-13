import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Camera from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

const OTP_LENGTH = 6;

interface OTPEntryProps {
  route: { params: { tripId: number; eventType: 'pickup' | 'dropoff' } };
  navigation: any;
}

export function OTPEntry({ route, navigation }: OTPEntryProps) {
  const { tripId, eventType } = route.params;
  const queryClient = useQueryClient();

  // OTP digits state
  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const inputRefs = useRef<(TextInput | null)[]>([]);

  // Fallback camera state
  const [showCamera, setShowCamera] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const cameraRef = useRef<Camera.CameraView | null>(null);
  const [hasCameraPermission, setHasCameraPermission] = useState(false);

  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasCameraPermission(status === 'granted');
    })();
    // Auto-focus first digit
    setTimeout(() => inputRefs.current[0]?.focus(), 300);
  }, []);

  // ── OTP Verify mutation ────────────────────────────────────────────────────
  const verifyOtp = useMutation({
    mutationFn: (otp: string) =>
      api.post(`/api/otp/${tripId}/verify`, { otp, eventType }).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trip', tripId] });
      queryClient.invalidateQueries({ queryKey: ['my-trips'] });
      Alert.alert(
        '✅ Verified!',
        eventType === 'pickup' ? 'Pickup confirmed. Safe travels!' : 'Dropoff confirmed. Trip complete!',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    },
    onError: (err: Error) => {
      Alert.alert('Verification Failed', err.message ?? 'Invalid or expired code. Please try again.');
      setDigits(Array(OTP_LENGTH).fill(''));
      inputRefs.current[0]?.focus();
    },
  });

  // ── Photo fallback mutation ────────────────────────────────────────────────
  const submitFallback = useMutation({
    mutationFn: async (uri: string) => {
      const form = new FormData();
      form.append('photo', {
        uri,
        name: `otp-fallback-${tripId}-${eventType}.jpg`,
        type: 'image/jpeg',
      } as any);
      form.append('eventType', eventType);
      return api.post(`/api/otp/${tripId}/fallback`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }).then(r => r.data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trip', tripId] });
      queryClient.invalidateQueries({ queryKey: ['my-trips'] });
      Alert.alert(
        '📷 Photo Submitted',
        'Fallback photo recorded. Trip verification logged.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    },
    onError: (err: Error) => Alert.alert('Upload Failed', err.message),
  });

  // ── OTP digit handling ─────────────────────────────────────────────────────
  const handleDigitChange = useCallback((value: string, index: number) => {
    // Handle paste of full code
    if (value.length === OTP_LENGTH) {
      const newDigits = value.split('').slice(0, OTP_LENGTH);
      setDigits(newDigits);
      inputRefs.current[OTP_LENGTH - 1]?.focus();
      return;
    }
    const cleaned = value.replace(/\D/g, '').slice(-1);
    const newDigits = [...digits];
    newDigits[index] = cleaned;
    setDigits(newDigits);
    if (cleaned && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  }, [digits]);

  const handleKeyPress = useCallback((key: string, index: number) => {
    if (key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }, [digits]);

  const otpCode = digits.join('');
  const isComplete = otpCode.length === OTP_LENGTH;

  // ── Camera capture ─────────────────────────────────────────────────────────
  const takePicture = async () => {
    if (!cameraRef.current) return;
    const photo = await cameraRef.current.takePictureAsync({ quality: 0.6 });
    if (photo) {
      setPhotoUri(photo.uri);
      setShowCamera(false);
    }
  };

  // ── Camera view ────────────────────────────────────────────────────────────
  if (showCamera) {
    return (
      <SafeAreaView style={styles.cameraContainer}>
        <Camera.CameraView ref={cameraRef} style={styles.camera} facing="back">
          <View style={styles.cameraOverlay}>
            <Text style={styles.cameraHint}>Take a clear photo of the rider</Text>
            <View style={styles.cameraControls}>
              <TouchableOpacity onPress={() => setShowCamera(false)} style={styles.cameraCancelBtn}>
                <Text style={styles.cameraCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={takePicture} style={styles.captureBtn}>
                <View style={styles.captureBtnInner} />
              </TouchableOpacity>
              <View style={{ width: 80 }} />
            </View>
          </View>
        </Camera.CameraView>
      </SafeAreaView>
    );
  }

  // ── Photo preview ──────────────────────────────────────────────────────────
  if (photoUri) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.photoPreview}>
          <Text style={styles.previewTitle}>Photo Preview</Text>
          <Text style={styles.previewSub}>This will be submitted as proof of service</Text>
          <Image source={{ uri: photoUri }} style={styles.previewImage} resizeMode="cover" />
          <View style={styles.previewActions}>
            <TouchableOpacity onPress={() => setPhotoUri(null)} style={styles.retakeBtn}>
              <Text style={styles.retakeBtnText}>Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => submitFallback.mutate(photoUri)}
              disabled={submitFallback.isPending}
              style={[styles.submitPhotoBtn, submitFallback.isPending && { opacity: 0.6 }]}
            >
              {submitFallback.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitPhotoBtnText}>Submit Photo</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── Main OTP screen ────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.inner}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.body}>
          {/* Icon + Title */}
          <View style={styles.iconBox}>
            <Text style={styles.iconEmoji}>{eventType === 'pickup' ? '🚐' : '🏁'}</Text>
          </View>
          <Text style={styles.title}>
            {eventType === 'pickup' ? 'Confirm Pickup' : 'Confirm Dropoff'}
          </Text>
          <Text style={styles.subtitle}>
            Ask the rider for the 6-digit code{'\n'}sent to their phone via SMS
          </Text>

          {/* OTP boxes */}
          <View style={styles.otpRow}>
            {Array.from({ length: OTP_LENGTH }).map((_, i) => (
              <TextInput
                key={i}
                ref={el => { inputRefs.current[i] = el; }}
                style={[
                  styles.otpBox,
                  digits[i] ? styles.otpBoxFilled : null,
                ]}
                value={digits[i]}
                onChangeText={v => handleDigitChange(v, i)}
                onKeyPress={({ nativeEvent }) => handleKeyPress(nativeEvent.key, i)}
                keyboardType="number-pad"
                maxLength={OTP_LENGTH} // allows paste
                selectTextOnFocus
                caretHidden
                textAlign="center"
              />
            ))}
          </View>

          {/* Verify button */}
          <TouchableOpacity
            style={[styles.verifyBtn, (!isComplete || verifyOtp.isPending) && styles.verifyBtnDisabled]}
            onPress={() => verifyOtp.mutate(otpCode)}
            disabled={!isComplete || verifyOtp.isPending}
          >
            {verifyOtp.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.verifyBtnText}>
                Verify {eventType === 'pickup' ? 'Pickup' : 'Dropoff'}
              </Text>
            )}
          </TouchableOpacity>

          {/* Divider */}
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>Rider has no phone?</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Fallback */}
          <TouchableOpacity
            style={[styles.fallbackBtn, !hasCameraPermission && { opacity: 0.5 }]}
            onPress={() => {
              if (!hasCameraPermission) {
                Alert.alert('Camera Required', 'Please allow camera access in Settings to use the photo fallback.');
                return;
              }
              Alert.alert(
                'Photo Fallback',
                'This will capture a photo of the rider as proof of service in place of an OTP. Continue?',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Open Camera', onPress: () => setShowCamera(true) },
                ]
              );
            }}
          >
            <Text style={styles.fallbackBtnText}>📷  Use Photo Fallback</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  inner: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  backBtn: { paddingVertical: 4 },
  backText: { fontSize: 15, color: '#2563eb', fontWeight: '500' },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 20,
  },
  iconBox: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconEmoji: { fontSize: 40 },
  title: { fontSize: 24, fontWeight: '800', color: '#111827', textAlign: 'center' },
  subtitle: { fontSize: 15, color: '#6b7280', textAlign: 'center', lineHeight: 22 },
  otpRow: { flexDirection: 'row', gap: 10, marginVertical: 8 },
  otpBox: {
    width: 48,
    height: 60,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
  },
  otpBoxFilled: { borderColor: '#2563eb', backgroundColor: '#eff6ff' },
  verifyBtn: {
    width: '100%',
    backgroundColor: '#2563eb',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
  },
  verifyBtnDisabled: { opacity: 0.4 },
  verifyBtnText: { fontSize: 17, fontWeight: '700', color: '#fff' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, width: '100%' },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#e5e7eb' },
  dividerText: { fontSize: 12, color: '#9ca3af', fontWeight: '500' },
  fallbackBtn: {
    width: '100%',
    borderWidth: 1.5,
    borderColor: '#d1d5db',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  fallbackBtnText: { fontSize: 15, color: '#374151', fontWeight: '600' },
  // Camera styles
  cameraContainer: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  cameraOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: 24,
    gap: 20,
    backgroundColor: 'transparent',
  },
  cameraHint: {
    textAlign: 'center',
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
  },
  cameraControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cameraCancelBtn: { width: 80, alignItems: 'center' },
  cameraCancelText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  captureBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureBtnInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#fff',
  },
  // Photo preview styles
  photoPreview: { flex: 1, padding: 20, gap: 16 },
  previewTitle: { fontSize: 22, fontWeight: '700', color: '#111827' },
  previewSub: { fontSize: 14, color: '#6b7280' },
  previewImage: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: '#e5e7eb',
    minHeight: 300,
  },
  previewActions: { flexDirection: 'row', gap: 12 },
  retakeBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: '#d1d5db',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  retakeBtnText: { fontSize: 15, color: '#374151', fontWeight: '600' },
  submitPhotoBtn: {
    flex: 2,
    backgroundColor: '#2563eb',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  submitPhotoBtnText: { fontSize: 15, color: '#fff', fontWeight: '700' },
});

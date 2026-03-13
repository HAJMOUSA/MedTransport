import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuthStore } from '../hooks/useAuth';

interface LoginResponse {
  user: { id: number; name: string; email: string; role: string; orgId: number };
  accessToken: string;
  refreshToken: string;
}

export function LoginScreen({ navigation }: { navigation: any }) {
  const { login } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);

  const loginMut = useMutation({
    mutationFn: () =>
      api.post<LoginResponse>('/api/auth/login', { email, password }).then(r => r.data),
    onSuccess: async (data) => {
      await login(data.user, data.accessToken, data.refreshToken);
      navigation.replace('Main');
    },
    onError: (err: Error) => {
      Alert.alert('Login Failed', err.message ?? 'Invalid email or password');
    },
  });

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.inner}
      >
        {/* Logo */}
        <View style={styles.logoBox}>
          <Text style={styles.logoEmoji}>🚐</Text>
          <Text style={styles.logoTitle}>MidTransport</Text>
          <Text style={styles.logoSub}>Driver App</Text>
        </View>

        <View style={styles.form}>
          <View>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="driver@company.com"
              placeholderTextColor="#9ca3af"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View>
            <Text style={styles.label}>Password</Text>
            <View style={styles.passwordRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor="#9ca3af"
                secureTextEntry={!showPw}
              />
              <TouchableOpacity
                onPress={() => setShowPw(v => !v)}
                style={styles.showPwBtn}
              >
                <Text style={styles.showPwText}>{showPw ? 'Hide' : 'Show'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.loginBtn, loginMut.isPending && styles.loginBtnDisabled]}
            onPress={() => loginMut.mutate()}
            disabled={loginMut.isPending || !email || !password}
          >
            {loginMut.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.loginBtnText}>Sign In</Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.footer}>
          Contact your dispatcher if you need help logging in
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#eff6ff' },
  inner: { flex: 1, justifyContent: 'center', padding: 24, gap: 32 },
  logoBox: { alignItems: 'center', gap: 4 },
  logoEmoji: { fontSize: 64, marginBottom: 8 },
  logoTitle: { fontSize: 30, fontWeight: '800', color: '#1e3a8a' },
  logoSub: { fontSize: 15, color: '#3b82f6', fontWeight: '600' },
  form: { backgroundColor: '#fff', borderRadius: 20, padding: 20, gap: 16 },
  label: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 4 },
  input: {
    borderWidth: 1.5,
    borderColor: '#d1d5db',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111827',
    backgroundColor: '#f9fafb',
  },
  passwordRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  showPwBtn: { paddingHorizontal: 8 },
  showPwText: { fontSize: 14, color: '#3b82f6', fontWeight: '600' },
  loginBtn: {
    backgroundColor: '#2563eb',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  loginBtnDisabled: { opacity: 0.5 },
  loginBtnText: { fontSize: 17, fontWeight: '700', color: '#fff' },
  footer: { textAlign: 'center', fontSize: 13, color: '#6b7280' },
});

import axios from 'axios';
import { useAuthStore } from '../hooks/useAuth';

// VITE_API_URL="" (empty) = same-origin via nginx proxy (production)
// VITE_API_URL="http://..." = explicit URL (local dev or direct access)
const API_BASE = import.meta.env.VITE_API_URL !== undefined && import.meta.env.VITE_API_URL !== ''
  ? import.meta.env.VITE_API_URL
  : (import.meta.env.DEV ? 'http://localhost:3001' : '');

export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: false,
});

// Attach token to every request
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Single-flight refresh: the refresh endpoint ROTATES the refresh token, so two
// concurrent refreshes (e.g. the burst of queries fired on a page reload) would
// invalidate each other and log the user out. All 401s share one refresh call.
let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    const refreshToken = useAuthStore.getState().refreshToken;
    refreshPromise = axios
      .post(`${API_BASE}/api/auth/refresh`, { refreshToken })
      .then(({ data }) => {
        useAuthStore.getState().setTokens(data.accessToken, data.refreshToken);
        return data.accessToken as string;
      })
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

// Auto-refresh on 401
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        const accessToken = await refreshAccessToken();
        original.headers.Authorization = `Bearer ${accessToken}`;
        return api(original);
      } catch {
        useAuthStore.getState().logout();
        window.location.href = '/login';
      }
    }
    // Unwrap API error messages so they surface in the UI
    if (error.response?.data?.message) {
      error.message = error.response.data.message;
    }
    return Promise.reject(error);
  }
);

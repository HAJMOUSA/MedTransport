import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'dispatcher' | 'driver';
  orgId: number;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      setAuth: (user, accessToken, refreshToken) =>
        set({ user, accessToken, refreshToken }),
      setTokens: (accessToken, refreshToken) =>
        set({ accessToken, refreshToken }),
      logout: () => set({ user: null, accessToken: null, refreshToken: null }),
      // A session is valid as long as we have a user and a refresh token. The
      // access token is intentionally NOT persisted (only kept in memory), so on
      // a page reload it is null — the first API call 401s and the response
      // interceptor silently mints a new access token from the refresh token.
      // Checking accessToken here caused every reload / deep-link to bounce to
      // the login screen before the refresh token was ever used.
      isAuthenticated: () => !!get().refreshToken && !!get().user,
    }),
    {
      name: 'midtransport-auth',
      partialize: (state) => ({
        user: state.user,
        refreshToken: state.refreshToken, // Only persist refresh token
      }),
    }
  )
);

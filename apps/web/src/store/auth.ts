import { create } from 'zustand';
import { api, onUnauthorized } from '@/lib/api';

export interface AuthUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  user_name: string;
  role: string;
  is_first_login: boolean;
  is_enabled: boolean;
  national_id: string;
  id_type: string;
  facility_id: number | null;
  department_id: number | null;
  /** Assigned regions — partner (monitor) users only; empty otherwise. */
  regions: { id: number; name: string }[];
  region_ids: number[];
  created_at: string;
  updated_at: string;
}

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  requirePasswordChange: boolean;

  // Derived
  isAuthenticated: boolean;

  // Actions
  checkAuth: () => Promise<void>;
  login: (login: string, password: string) => Promise<{ error: string | null }>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ error: string | null }>;
}

// Callbacks run when the session ends (logout or a 401), e.g. to clear cached
// query data so another user on the same tab never sees it. Registered by
// main.tsx, which owns the QueryClient, to avoid an import cycle.
const sessionEndHandlers: (() => void)[] = [];
export function onSessionEnd(handler: () => void): void { sessionEndHandlers.push(handler); }
function sessionEnded(): void { sessionEndHandlers.forEach((h) => h()); }

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  requirePasswordChange: false,
  isAuthenticated: false,

  checkAuth: async () => {
    set({ isLoading: true });
    const res = await api.get<{ user: AuthUser; requirePasswordChange: boolean }>('/auth/me');
    if (res.error !== null) {
      set({ user: null, isAuthenticated: false, isLoading: false, requirePasswordChange: false });
    } else {
      set({
        user: res.data.user,
        isAuthenticated: true,
        requirePasswordChange: res.data.requirePasswordChange,
        isLoading: false,
      });
    }
  },

  login: async (login, password) => {
    const res = await api.post<{ user: AuthUser; requirePasswordChange: boolean }>('/auth/login', {
      login,
      password,
    });
    if (res.error !== null) {
      return { error: res.error };
    }
    set({
      user: res.data.user,
      isAuthenticated: true,
      requirePasswordChange: res.data.requirePasswordChange,
    });
    return { error: null };
  },

  logout: async () => {
    await api.post('/auth/logout', {});
    set({ user: null, isAuthenticated: false, requirePasswordChange: false });
    sessionEnded();
  },

  changePassword: async (currentPassword, newPassword) => {
    const res = await api.post<{ message: string }>('/auth/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
    });
    if (res.error !== null) {
      return { error: res.error };
    }
    set({ requirePasswordChange: false, user: null });
    // Refresh user from server to get updated is_first_login
    const meRes = await api.get<{ user: AuthUser; requirePasswordChange: boolean }>('/auth/me');
    if (meRes.error === null) {
      set({ user: meRes.data.user });
    }
    return { error: null };
  },
}));

// A 401 from any non-/auth request ends the session client-side too.
onUnauthorized(() => {
  if (useAuthStore.getState().user) {
    useAuthStore.setState({ user: null, isAuthenticated: false, requirePasswordChange: false });
    sessionEnded();
  }
});

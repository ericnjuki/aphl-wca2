import { create } from 'zustand';
import { api } from '@/lib/api';

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

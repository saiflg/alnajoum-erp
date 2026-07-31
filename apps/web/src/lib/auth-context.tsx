'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiRequest, ApiError } from './api';
import { CurrentUser } from './types';

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<CurrentUser>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const me = await apiRequest<CurrentUser>('/auth/me');
      setUser(me);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setUser(null);
      } else {
        throw error;
      }
    }
  }, []);

  useEffect(() => {
    refreshUser().finally(() => setLoading(false));
  }, [refreshUser]);

  const login = useCallback(async (email: string, password: string) => {
    await apiRequest('/auth/login', {
      method: 'POST',
      body: { email, password },
      retryOn401: false,
    });
    const me = await apiRequest<CurrentUser>('/auth/me');
    setUser(me);
    return me;
  }, []);

  const logout = useCallback(async () => {
    await apiRequest('/auth/logout', { method: 'POST', retryOn401: false }).catch(() => undefined);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiRequest, ApiError, clearStepUp } from './api';
import { clearOfflineCache } from './offline-cache';
import { CurrentUser } from './types';

interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
}

/** The password was right but the account has two-factor on: no session exists until the code is verified. */
export interface TwoFactorRequired {
  requiresTwoFactor: true;
  challengeToken: string;
}

export function needsTwoFactor(
  result: CurrentUser | TwoFactorRequired,
): result is TwoFactorRequired {
  return (result as TwoFactorRequired).requiresTwoFactor === true;
}

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<CurrentUser | TwoFactorRequired>;
  verifyTwoFactor: (challengeToken: string, code: string) => Promise<CurrentUser>;
  register: (input: RegisterInput) => Promise<CurrentUser>;
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
    let ignore = false;
    // This is the standard "check auth on mount" idiom: a session check that
    // must resolve before the app can decide public vs. protected content.
    // react-hooks/set-state-in-effect wants Suspense/an external store for
    // any async setState from an effect, which isn't warranted here — the
    // `ignore` guard above already prevents the real hazard (a stray update
    // after unmount).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshUser().finally(() => {
      if (!ignore) setLoading(false);
    });
    return () => {
      ignore = true;
    };
  }, [refreshUser]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await apiRequest<{ requiresTwoFactor?: boolean; challengeToken?: string } | null>(
      '/auth/login',
      {
        method: 'POST',
        body: { email, password },
        retryOn401: false,
      },
    );
    // Two-factor accounts used to be locked out of the web app: the challenge was ignored and the
    // follow-up /auth/me failed because no session had been issued.
    if (result?.requiresTwoFactor && result.challengeToken) {
      return { requiresTwoFactor: true, challengeToken: result.challengeToken } as TwoFactorRequired;
    }
    const me = await apiRequest<CurrentUser>('/auth/me');
    setUser(me);
    return me;
  }, []);

  const verifyTwoFactor = useCallback(async (challengeToken: string, code: string) => {
    await apiRequest('/auth/2fa/login-verify', {
      method: 'POST',
      body: { challengeToken, code },
      retryOn401: false,
    });
    const me = await apiRequest<CurrentUser>('/auth/me');
    setUser(me);
    return me;
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    await apiRequest('/auth/register', {
      method: 'POST',
      body: input,
      retryOn401: false,
    });
    const me = await apiRequest<CurrentUser>('/auth/me');
    setUser(me);
    return me;
  }, []);

  const logout = useCallback(async () => {
    await apiRequest('/auth/logout', { method: 'POST', retryOn401: false }).catch(() => undefined);
    // Phase 8 §14: a signed-out device keeps no cached roster or pending
    // offline check-ins for this identity, alongside the normal cookie
    // invalidation above.
    if (user) await clearOfflineCache(user.id);
    clearStepUp();
    setUser(null);
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, loading, login, verifyTwoFactor, register, logout, refreshUser }}>
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

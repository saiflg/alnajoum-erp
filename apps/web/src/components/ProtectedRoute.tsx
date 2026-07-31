'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** If given, the user must hold at least one of these roles. */
  allowedRoles?: string[];
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const router = useRouter();

  const isAllowed = !allowedRoles || (user && allowedRoles.some((r) => user.roles.includes(r)));

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (!isAllowed) {
      router.replace(user.dashboardPath);
    }
  }, [loading, user, isAllowed, router]);

  if (loading || !user || !isAllowed) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        Loading…
      </div>
    );
  }

  return <>{children}</>;
}

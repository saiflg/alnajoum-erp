'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? user.dashboardPath : '/login');
  }, [loading, user, router]);

  return (
    <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
      Loading…
    </div>
  );
}

'use client';

import { ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Badge } from '@/components/comm/ui';
import { useAuth } from '@/lib/auth-context';
import { navForRoles } from '@/lib/nav-for-roles';

const ROLES = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'STAFF', 'AUDITOR'];

/** The frame every Communication Centre page shares: sign-in required, the usual menu, the page title. */
export function CommPage({ title, children }: { title: string; children: ReactNode }) {
  const { user } = useAuth();
  return (
    <ProtectedRoute allowedRoles={ROLES}>
      <AppShell title={title} navLinks={navForRoles(user?.roles ?? [])}>
        {children}
      </AppShell>
    </ProtectedRoute>
  );
}

/** Consent state of one channel, in words a person can read at a glance. */
export function ConsentBadge({ channel, status }: { channel: 'WHATSAPP' | 'EMAIL'; status?: string }) {
  const s = status ?? 'NONE';
  const label = channel === 'EMAIL' ? 'Email' : 'WhatsApp';
  const text: Record<string, string> = {
    SUBSCRIBED: 'subscribed',
    PENDING_CONFIRMATION: 'awaiting confirmation',
    UNSUBSCRIBED: 'unsubscribed',
    NONE: 'no consent',
  };
  return (
    <span className="mr-1 inline-flex items-center gap-1 text-xs">
      <span className="text-slate-500">{label}:</span>
      <Badge value={text[s] ?? s} />
    </span>
  );
}

export const subStatus = (c: { subscriptions?: { channel: string; status: string }[] }, channel: string) =>
  c.subscriptions?.find((s) => s.channel === channel)?.status;

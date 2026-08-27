'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { apiRequest } from '@/lib/api';
import { formatCurrency } from '@/lib/format';
import { useAuth } from '@/lib/auth-context';
import { PORTAL_NAV } from '@/lib/portal-nav';
import {
  FamilyMember,
  FlightBooking,
  HajjRegistration,
  Invoice,
  Notification,
  UmrahRegistration,
  WalletWithBalance,
} from '@/lib/types';

function StatTile({ label, value, href }: { label: string; value: string; href?: string }) {
  const content = (
    <div className="rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

export default function CustomerPortalDashboardPage() {
  const { user } = useAuth();

  const [wallet, setWallet] = useState<WalletWithBalance | null>(null);
  const [bookings, setBookings] = useState<FlightBooking[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [hajjRegistrations, setHajjRegistrations] = useState<HajjRegistration[]>([]);
  const [umrahRegistrations, setUmrahRegistrations] = useState<UmrahRegistration[]>([]);
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    apiRequest<WalletWithBalance>('/wallet/me').then(setWallet).catch(() => undefined);
    apiRequest<FlightBooking[]>('/flights/bookings/me').then(setBookings).catch(() => undefined);
    apiRequest<Invoice[]>('/invoices/me').then(setInvoices).catch(() => undefined);
    apiRequest<HajjRegistration[]>('/hajj/registrations/me').then(setHajjRegistrations).catch(() => undefined);
    apiRequest<UmrahRegistration[]>('/umrah/registrations/me').then(setUmrahRegistrations).catch(() => undefined);
    apiRequest<FamilyMember[]>('/customers/me/family-members').then(setFamilyMembers).catch(() => undefined);
    apiRequest<Notification[]>('/notifications/me').then(setNotifications).catch(() => undefined);
  }, []);

  const activeBookings = bookings.filter((b) => b.status === 'CONFIRMED').length;
  const pendingPayments = invoices.filter((inv) => inv.status === 'ISSUED' || inv.status === 'PARTIALLY_PAID').length;
  const unreadNotifications = notifications.filter((n) => !n.isRead).length;
  const recentTransactions = wallet?.transactions.slice(0, 5) ?? [];

  return (
    <ProtectedRoute allowedRoles={['CUSTOMER']}>
      <AppShell title="Customer Portal" navLinks={PORTAL_NAV}>
        <h2 className="text-lg font-semibold text-slate-900">
          Welcome{user ? `, ${user.email}` : ''}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          Manage your wallet, family, Hajj &amp; Umrah registrations, bookings, and payments — all in one place.
        </p>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <StatTile
            label="Wallet Balance"
            value={wallet ? formatCurrency(wallet.balance, wallet.wallet.currency) : '—'}
            href="/portal/wallet"
          />
          <StatTile label="Active Bookings" value={String(activeBookings)} href="/portal/flights" />
          <StatTile label="Pending Payments" value={String(pendingPayments)} href="/portal/invoices" />
          <StatTile label="Hajj Applications" value={String(hajjRegistrations.length)} href="/portal/hajj" />
          <StatTile label="Umrah Applications" value={String(umrahRegistrations.length)} href="/portal/umrah" />
          <StatTile label="Family Members" value={String(familyMembers.length)} href="/portal/family" />
          <StatTile label="Notifications" value={String(unreadNotifications)} href="/portal/notifications" />
        </div>

        <h3 className="mt-8 text-sm font-semibold text-slate-900">Recent Wallet Transactions</h3>
        <div className="mt-2 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Description</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Status</th>
                <th className="px-4 py-2 text-right font-medium text-slate-600">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recentTransactions.map((txn) => (
                <tr key={txn.id}>
                  <td className="px-4 py-2 text-slate-700">{txn.description}</td>
                  <td className="px-4 py-2 text-slate-600">{txn.status}</td>
                  <td
                    className={`px-4 py-2 text-right font-medium ${txn.amount >= 0 ? 'text-emerald-600' : 'text-red-600'}`}
                  >
                    {txn.amount >= 0 ? '+' : ''}
                    {formatCurrency(txn.amount, txn.currency)}
                  </td>
                </tr>
              ))}
              {recentTransactions.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500" colSpan={3}>
                    No wallet activity yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/portal/flights/search"
            className="inline-block rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm hover:border-slate-300"
          >
            Book a Flight
          </Link>
          <Link
            href="/portal/hajj"
            className="inline-block rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm hover:border-slate-300"
          >
            Browse Hajj Packages
          </Link>
          <Link
            href="/portal/umrah"
            className="inline-block rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm hover:border-slate-300"
          >
            Browse Umrah Packages
          </Link>
          <Link
            href="/portal/wallet"
            className="inline-block rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm hover:border-slate-300"
          >
            Top Up Wallet
          </Link>
          <Link
            href="/portal/profile"
            className="inline-block rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm hover:border-slate-300"
          >
            Manage My Profile &amp; Documents
          </Link>
          <Link
            href="/portal/family"
            className="inline-block rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm hover:border-slate-300"
          >
            Manage Family Members
          </Link>
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}

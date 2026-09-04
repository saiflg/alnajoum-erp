'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';

interface Kpis {
  bookings: number;
  completed: number;
  cancelled: number;
  refunds: number;
  revenue: number;
  supplierCost: number;
  markup: number;
  margin: number;
  staffIncentives: number;
  popularDestinations: Array<{ city: string; count: number }>;
  popularHotels: Array<{ hotelName: string; count: number }>;
}

interface ProfitRow {
  bookingId: string;
  bookingReference: string;
  customer: string;
  hotel: string;
  city: string;
  supplierCost: number;
  sellingPrice: number;
  markup: number;
  margin: number;
  staffIncentive: number;
  companyShare: number;
  status: string;
  staff: string | null;
  branch: string | null;
  date: string;
  currency: string;
}

const KPI_CARDS: { key: keyof Kpis; label: string; money?: boolean }[] = [
  { key: 'bookings', label: 'Bookings' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'refunds', label: 'Refunds' },
  { key: 'revenue', label: 'Revenue', money: true },
  { key: 'supplierCost', label: 'Supplier Cost', money: true },
  { key: 'markup', label: 'Markup', money: true },
  { key: 'margin', label: 'Margin', money: true },
  { key: 'staffIncentives', label: 'Staff Incentives', money: true },
];

export default function AdminHotelReportsPage() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [rows, setRows] = useState<ProfitRow[] | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);

  function load() {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    apiRequest<Kpis>(`/hotels/reports/kpis?${params.toString()}`)
      .then(setKpis)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
    apiRequest<ProfitRow[]>(`/hotels/reports/profit?${params.toString()}`)
      .then(setRows)
      .catch(() => undefined);
  }

  useEffect(load, []);

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'FINANCE_OFFICER']}>
      <AppShell title="Hotel Reports" navLinks={ADMIN_NAV}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Hotel Admin Dashboard</h2>
          <div className="flex items-end gap-2">
            <label className="text-xs text-slate-500">
              From
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-xs text-slate-500">
              To
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <button
              onClick={load}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Apply
            </button>
          </div>
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          {kpis &&
            KPI_CARDS.map(({ key, label, money }) => (
              <div key={key} className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {money ? formatCurrency(kpis[key] as number, 'NGN') : (kpis[key] as number)}
                </p>
              </div>
            ))}
        </div>

        {kpis && (kpis.popularDestinations.length > 0 || kpis.popularHotels.length > 0) && (
          <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Popular Destinations</h3>
              <div className="mt-3 space-y-2">
                {kpis.popularDestinations.map((d) => (
                  <div key={d.city} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                    <span className="text-slate-700">{d.city}</span>
                    <span className="font-medium text-slate-900">{d.count} booking(s)</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Popular Hotels</h3>
              <div className="mt-3 space-y-2">
                {kpis.popularHotels.map((h) => (
                  <div key={h.hotelName} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                    <span className="text-slate-700">{h.hotelName}</span>
                    <span className="font-medium text-slate-900">{h.count} booking(s)</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <h3 className="mt-8 text-sm font-semibold text-slate-900">Per-Booking Profit Report</h3>
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Reference</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Customer</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Hotel</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">City</th>
                <th className="px-3 py-2 text-right font-medium text-slate-600">Cost</th>
                <th className="px-3 py-2 text-right font-medium text-slate-600">Selling</th>
                <th className="px-3 py-2 text-right font-medium text-slate-600">Margin</th>
                <th className="px-3 py-2 text-right font-medium text-slate-600">Incentive</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Status</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Staff</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows?.map((r) => (
                <tr key={r.bookingId}>
                  <td className="px-3 py-2 font-medium text-slate-800">{r.bookingReference}</td>
                  <td className="px-3 py-2 text-slate-600">{r.customer}</td>
                  <td className="px-3 py-2 text-slate-600">{r.hotel}</td>
                  <td className="px-3 py-2 text-slate-600">{r.city}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{formatCurrency(r.supplierCost, r.currency)}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{formatCurrency(r.sellingPrice, r.currency)}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{formatCurrency(r.margin, r.currency)}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{formatCurrency(r.staffIncentive, r.currency)}</td>
                  <td className="px-3 py-2 text-slate-600">{r.status.replace(/_/g, ' ')}</td>
                  <td className="px-3 py-2 text-slate-600">{r.staff ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-500">{formatDateTime(r.date)}</td>
                </tr>
              ))}
              {rows?.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={11}>
                    No data for this period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}

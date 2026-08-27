'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { apiRequest, ApiError } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { PORTAL_NAV } from '@/lib/portal-nav';
import { FamilyMember, UmrahPackage, UmrahRegistration } from '@/lib/types';

export default function UmrahPage() {
  const [packages, setPackages] = useState<UmrahPackage[] | null>(null);
  const [registrations, setRegistrations] = useState<UmrahRegistration[] | null>(null);
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [openPackageId, setOpenPackageId] = useState<string | null>(null);
  const [includeSelf, setIncludeSelf] = useState(true);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [registering, setRegistering] = useState(false);

  function load() {
    apiRequest<UmrahPackage[]>('/umrah/packages').then(setPackages).catch((err) => setError(err.message));
    apiRequest<UmrahRegistration[]>('/umrah/registrations/me')
      .then(setRegistrations)
      .catch((err) => setError(err.message));
    apiRequest<FamilyMember[]>('/customers/me/family-members')
      .then(setFamilyMembers)
      .catch(() => undefined);
  }

  useEffect(load, []);

  function openRegisterForm(packageId: string) {
    setOpenPackageId(openPackageId === packageId ? null : packageId);
    setIncludeSelf(true);
    setSelectedMemberIds([]);
    setNotice(null);
  }

  function toggleMember(memberId: string) {
    setSelectedMemberIds((prev) =>
      prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId],
    );
  }

  async function handleRegister(packageId: string) {
    const pilgrims = [
      ...(includeSelf ? [{}] : []),
      ...selectedMemberIds.map((familyMemberId) => ({ familyMemberId })),
    ];
    if (pilgrims.length === 0) {
      setError('Select at least one pilgrim');
      return;
    }
    setError(null);
    setRegistering(true);
    try {
      await apiRequest('/umrah/registrations/me', {
        method: 'POST',
        body: { packageId, pilgrims },
      });
      setNotice('Registration confirmed! Scroll down to see your progress and pay your invoice.');
      setOpenPackageId(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to register');
    } finally {
      setRegistering(false);
    }
  }

  return (
    <ProtectedRoute allowedRoles={['CUSTOMER']}>
      <AppShell title="Umrah Packages" navLinks={PORTAL_NAV}>
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
        {notice && <p className="mb-4 text-sm text-emerald-600">{notice}</p>}

        <h2 className="text-lg font-semibold text-slate-900">Available Umrah Packages</h2>
        <p className="mt-1 text-sm text-slate-500">
          Register yourself and any family members for a package, then pay in installments.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {packages?.map((pkg) => (
            <div key={pkg.id} className="rounded-lg border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-slate-900">{pkg.name}</p>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                  {pkg.packageType}
                </span>
              </div>
              {pkg.description && <p className="mt-1 text-sm text-slate-500">{pkg.description}</p>}
              <p className="mt-2 text-xl font-semibold text-slate-900">
                {formatCurrency(pkg.sellingPrice, pkg.currency)}{' '}
                <span className="text-sm font-normal text-slate-500">per pilgrim</span>
              </p>
              <ul className="mt-2 space-y-0.5 text-sm text-slate-600">
                {pkg.durationDays && <li>{pkg.durationDays} days</li>}
                {pkg.hotel && <li>Hotel: {pkg.hotel}</li>}
                {pkg.flight && <li>Flight: {pkg.flight}</li>}
                <li>{pkg.seatsAvailable} seats remaining</li>
              </ul>

              <button
                onClick={() => openRegisterForm(pkg.id)}
                disabled={pkg.seatsAvailable === 0}
                className="mt-4 w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {pkg.seatsAvailable === 0 ? 'Fully booked' : openPackageId === pkg.id ? 'Cancel' : 'Register'}
              </button>

              {openPackageId === pkg.id && (
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <p className="text-sm font-medium text-slate-700">Who is going?</p>
                  <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={includeSelf} onChange={(e) => setIncludeSelf(e.target.checked)} />
                    Myself
                  </label>
                  {familyMembers.map((member) => (
                    <label key={member.id} className="mt-1 flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={selectedMemberIds.includes(member.id)}
                        onChange={() => toggleMember(member.id)}
                      />
                      {member.firstName} {member.lastName} ({member.relationship})
                    </label>
                  ))}
                  {familyMembers.length === 0 && (
                    <p className="mt-1 text-xs text-slate-500">
                      No family members on file — add them under Family Members to register with them.
                    </p>
                  )}
                  <button
                    onClick={() => handleRegister(pkg.id)}
                    disabled={registering}
                    className="mt-3 w-full rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-400 disabled:opacity-50"
                  >
                    {registering ? 'Registering…' : 'Confirm registration'}
                  </button>
                </div>
              )}
            </div>
          ))}
          {packages?.length === 0 && (
            <p className="text-sm text-slate-500">No Umrah packages are open for registration right now.</p>
          )}
        </div>

        <h2 className="mt-10 text-lg font-semibold text-slate-900">My Umrah Registrations</h2>
        <div className="mt-4 space-y-3">
          {registrations?.map((reg) => {
            const paid = reg.invoice?.payments.reduce((sum, p) => sum + p.amount, 0) ?? 0;
            const pct = reg.totalAmount > 0 ? Math.round((paid / reg.totalAmount) * 100) : 0;
            return (
              <div key={reg.id} className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-900">
                      {reg.package.name} <span className="ml-2 text-xs text-slate-500">{reg.registrationNumber}</span>
                    </p>
                    <p className="text-sm text-slate-500">
                      {reg.pilgrims.length} pilgrim{reg.pilgrims.length === 1 ? '' : 's'} · {reg.status} ·{' '}
                      {formatDateTime(reg.createdAt)}
                    </p>
                  </div>
                  {reg.invoice && (
                    <Link
                      href={`/portal/invoices/${reg.invoice.id}`}
                      className="text-sm font-medium text-slate-700 hover:underline"
                    >
                      View invoice
                    </Link>
                  )}
                </div>
                <div className="mt-3">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-amber-500" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatCurrency(paid, reg.currency)} of {formatCurrency(reg.totalAmount, reg.currency)} paid ({pct}%)
                  </p>
                </div>
              </div>
            );
          })}
          {registrations?.length === 0 && (
            <p className="text-sm text-slate-500">You have not registered for an Umrah package yet.</p>
          )}
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}

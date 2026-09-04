'use client';

import { useEffect, useState } from 'react';
import { apiRequest } from '@/lib/api';
import type { PilgrimType } from '@/lib/hajj-ops-types';

interface PilgrimStatus {
  pilgrim: {
    id: string;
    firstName: string;
    lastName: string;
    group: { groupNumber: string; name: string; status: string; departureDate: string | null } | null;
  };
  readiness: {
    finalStatus: 'GREEN' | 'AMBER' | 'RED';
    missingDocuments: string[];
    visaStatus: string;
    paymentComplete: boolean;
    outstandingAmount: number;
    flightAssigned: boolean;
    hotelAssigned: boolean;
    override: { reason: string } | null;
  };
  qrCode: string;
}

const STATUS_LABEL: Record<PilgrimStatus['readiness']['finalStatus'], string> = {
  GREEN: 'Ready for departure',
  AMBER: 'Almost ready — a few items pending',
  RED: 'Action needed before departure',
};

/**
 * Spec #19/#37 — a pilgrim's own group/readiness/QR status, shown on the
 * customer portal. One card per pilgrim (self or family member) travelling
 * under a Hajj/Umrah registration.
 */
export function PilgrimStatusCard({ type, pilgrimId, name }: { type: PilgrimType; pilgrimId: string; name: string }) {
  const [status, setStatus] = useState<PilgrimStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<PilgrimStatus>(`/hajj-ops/portal/${type}/${pilgrimId}`)
      .then(setStatus)
      .catch(() => setError('Group/readiness status not available yet.'));
  }, [type, pilgrimId]);

  if (error) return null; // pilgrim not yet in a group — nothing to show
  if (!status) return null;

  const cls =
    status.readiness.finalStatus === 'GREEN'
      ? 'border-emerald-200 bg-emerald-50'
      : status.readiness.finalStatus === 'AMBER'
        ? 'border-amber-200 bg-amber-50'
        : 'border-red-200 bg-red-50';

  return (
    <div className={`mt-3 rounded-lg border p-4 ${cls}`}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-900">{name} — Departure Readiness</p>
        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-700">
          {status.readiness.finalStatus}
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-700">{STATUS_LABEL[status.readiness.finalStatus]}</p>
      {status.pilgrim.group && (
        <p className="mt-1 text-xs text-slate-500">
          Group: {status.pilgrim.group.name} ({status.pilgrim.group.groupNumber}) — {status.pilgrim.group.status.replace(/_/g, ' ')}
        </p>
      )}
      {status.readiness.override ? (
        <p className="mt-1 text-xs text-slate-600">Staff note: {status.readiness.override.reason}</p>
      ) : (
        <>
          {status.readiness.missingDocuments.length > 0 && (
            <p className="mt-1 text-xs text-slate-600">Missing documents: {status.readiness.missingDocuments.join(', ')}</p>
          )}
          {!status.readiness.paymentComplete && status.readiness.outstandingAmount > 0 && (
            <p className="mt-1 text-xs text-slate-600">Outstanding balance on your registration invoice.</p>
          )}
        </>
      )}
      <p className="mt-2 text-xs text-slate-500">
        Travel document QR code: <span className="font-mono font-medium text-slate-700">{status.qrCode}</span> — present this at
        group check-in, airport, and hotel check-in.
      </p>
    </div>
  );
}

'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BrandMark } from '@/components/BrandMark';
import { apiRequest, ApiError } from '@/lib/api';

interface StaffVerification {
  employeeCode: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  department: string | null;
  companyName: string;
  branchName: string | null;
  isActive: boolean;
}

/**
 * Public, unauthenticated page a staff ID badge's QR code points at (see
 * StaffIdCardService.verifyUrl on the backend). Anyone who scans a badge
 * lands here — no login required, same as scanning any physical ID card —
 * and sees exactly what's already printed on the card plus a live
 * active/inactive flag, so a deactivated badge reads as invalid the moment
 * it's scanned even though the physical card itself hasn't changed.
 */
export default function StaffVerifyPage() {
  const params = useParams<{ employeeCode: string }>();
  const [result, setResult] = useState<StaffVerification | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest<StaffVerification>(
      `/staff/verify/${encodeURIComponent(params.employeeCode)}`,
    )
      .then(setResult)
      .catch((err) =>
        setError(
          err instanceof ApiError && err.status === 404
            ? 'No staff member matches this ID card.'
            : 'Could not verify this ID card right now.',
        ),
      )
      .finally(() => setLoading(false));
  }, [params.employeeCode]);

  return (
    <div className="flex min-h-screen flex-1 items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="flex justify-center">
          <BrandMark size={40} />
        </div>
        <p className="mt-2 text-xs font-medium text-slate-500">
          Alnajoum Travel Agency — Staff Verification
        </p>

        {loading && <p className="mt-6 text-sm text-slate-400">Checking…</p>}

        {!loading && error && (
          <div className="mt-6">
            <span className="inline-block rounded-full bg-red-100 px-3 py-1 text-sm font-semibold text-red-700">
              Not a valid staff ID
            </span>
            <p className="mt-3 text-sm text-slate-500">{error}</p>
          </div>
        )}

        {!loading && result && (
          <div className="mt-6">
            <span
              className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ${
                result.isActive
                  ? 'bg-green-100 text-green-700'
                  : 'bg-red-100 text-red-700'
              }`}
            >
              {result.isActive ? 'Valid Employee ID' : 'Inactive — Not a Current Employee'}
            </span>

            <p className="mt-4 text-lg font-semibold text-slate-900">
              {result.firstName} {result.lastName}
            </p>
            <p className="text-sm text-slate-500">
              {result.jobTitle ?? result.department ?? 'Staff'}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {result.branchName ?? result.companyName}
            </p>

            <p className="mt-4 font-mono text-xs text-slate-400">
              Employee ID: {result.employeeCode}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

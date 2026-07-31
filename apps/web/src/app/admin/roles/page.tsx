'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest } from '@/lib/api';

interface RoleWithPermissions {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: { permission: { key: string } }[];
}

export default function RolesPage() {
  const [roles, setRoles] = useState<RoleWithPermissions[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<RoleWithPermissions[]>('/rbac/roles')
      .then(setRoles)
      .catch((err) => setError(err.message));
  }, []);

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN']}>
      <AppShell title="Roles" navLinks={ADMIN_NAV}>
        <h2 className="text-lg font-semibold text-slate-900">Roles &amp; Permissions</h2>
        <p className="mt-1 text-sm text-slate-500">
          Phase 1 ships with a fixed set of system roles used to route staff to
          the correct dashboard.
        </p>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-4 space-y-4">
          {roles?.map((role) => (
            <div key={role.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-slate-900">{role.name}</h3>
                {role.isSystem && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                    System
                  </span>
                )}
              </div>
              {role.description && (
                <p className="mt-1 text-sm text-slate-600">{role.description}</p>
              )}
              <div className="mt-2 flex flex-wrap gap-1">
                {role.permissions.map((p) => (
                  <span
                    key={p.permission.key}
                    className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600"
                  >
                    {p.permission.key}
                  </span>
                ))}
                {role.permissions.length === 0 && (
                  <span className="text-xs text-slate-400">No permissions assigned</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}

'use client';

import { useParams } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { HajjOpsGroupDetail } from '@/components/HajjOpsGroupDetail';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';

export default function HajjGroupDetailPage() {
  const params = useParams<{ id: string }>();

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'STAFF']}>
      <AppShell title="Hajj Group" navLinks={ADMIN_NAV}>
        <HajjOpsGroupDetail type="HAJJ" groupId={params.id} />
      </AppShell>
    </ProtectedRoute>
  );
}

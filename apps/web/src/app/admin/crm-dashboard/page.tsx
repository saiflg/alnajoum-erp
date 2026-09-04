'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

interface StaffDashboard {
  myLeads: number;
  myTasks: number;
  upcomingTravel: number;
  pendingApplications: number;
  openTickets: number;
}

interface CompanyDashboard {
  totalCustomers: number;
  newLeads: number;
  conversionRate: number;
  slaBreaches: number;
  openTickets: number;
  activeCampaigns: number;
}

function Card({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}

export default function CrmDashboardPage() {
  const { user } = useAuth();
  const roles = user?.roles ?? [];
  const isAdmin = roles.includes('SUPER_ADMIN') || roles.includes('COMPANY_ADMIN');

  const [staffDashboard, setStaffDashboard] = useState<StaffDashboard | null>(null);
  const [companyDashboard, setCompanyDashboard] = useState<CompanyDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<StaffDashboard>('/crm/reports/dashboard/me')
      .then(setStaffDashboard)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load dashboard'));
    if (isAdmin) {
      apiRequest<CompanyDashboard>('/crm/reports/dashboard/company').then(setCompanyDashboard).catch(() => undefined);
    }
  }, [isAdmin]);

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'STAFF']}>
      <AppShell title="CRM Dashboard" navLinks={ADMIN_NAV}>
        <h2 className="text-lg font-semibold text-slate-900">CRM Dashboard</h2>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        {staffDashboard && (
          <>
            <h3 className="mt-4 text-sm font-semibold text-slate-700">My Overview</h3>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Card label="My Open Leads" value={staffDashboard.myLeads} />
              <Card label="My Tasks" value={staffDashboard.myTasks} />
              <Card label="Upcoming Travel" value={staffDashboard.upcomingTravel} />
              <Card label="Pending Applications" value={staffDashboard.pendingApplications} />
              <Card label="Open Tickets" value={staffDashboard.openTickets} />
            </div>
          </>
        )}

        {companyDashboard && (
          <>
            <h3 className="mt-8 text-sm font-semibold text-slate-700">Company-Wide</h3>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Card label="Total Customers" value={companyDashboard.totalCustomers} />
              <Card label="New Leads (30d)" value={companyDashboard.newLeads} />
              <Card label="Conversion Rate" value={`${companyDashboard.conversionRate}%`} />
              <Card label="SLA Breaches" value={companyDashboard.slaBreaches} />
              <Card label="Open Tickets" value={companyDashboard.openTickets} />
              <Card label="Active Campaigns" value={companyDashboard.activeCampaigns} />
            </div>
          </>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}

import type { NavLink } from '@/components/AppShell';
import { ADMIN_NAV, FINANCE_NAV } from './admin-nav';

/** The few places a branch manager or an ordinary staff member can go (everything else is for administrators). */
export const BRANCH_NAV: NavLink[] = [
  { href: '/branch/dashboard', label: 'Dashboard' },
  { href: '/admin/executive', label: 'Executive Analytics' },
  { href: '/admin/branches', label: 'Branches' },
  { href: '/admin/staff', label: 'Staff' },
  { href: '/admin/staff-cards', label: 'Identification Cards' },
  { href: '/admin/staff-cards/scanner', label: 'Card Scanner' },
  { href: '/admin/communication', label: 'Communication Centre' },
];

export const STAFF_NAV: NavLink[] = [
  { href: '/staff/dashboard', label: 'Dashboard' },
  { href: '/admin/staff-cards/scanner', label: 'Card Scanner' },
  { href: '/admin/communication/contacts', label: 'Contacts' },
];

/** Picks the navigation for whoever is signed in, so shared pages (the scanner, contacts) keep their own menu. */
export function navForRoles(roles: string[]): NavLink[] {
  if (roles.includes('SUPER_ADMIN') || roles.includes('COMPANY_ADMIN')) return ADMIN_NAV;
  if (roles.includes('FINANCE_OFFICER')) return FINANCE_NAV;
  if (roles.includes('BRANCH_MANAGER')) return BRANCH_NAV;
  return STAFF_NAV;
}

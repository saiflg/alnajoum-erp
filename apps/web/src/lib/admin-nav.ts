import type { NavLink } from '@/components/AppShell';

export const ADMIN_NAV: NavLink[] = [
  { href: '/admin/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { href: '/admin/companies', label: 'Companies', icon: 'company' },
  { href: '/admin/branches', label: 'Branches', icon: 'branch' },
  { href: '/admin/staff', label: 'Staff', icon: 'staff' },
  { href: '/admin/customers', label: 'Customers', icon: 'customer' },
  { href: '/admin/flights', label: 'Flight Bookings', icon: 'flight' },
  { href: '/admin/flight-pricing-rules', label: 'Flight Pricing Rules', icon: 'flight' },
  { href: '/admin/flight-reports', label: 'Flight Reports', icon: 'invoice' },
  { href: '/admin/hotels', label: 'Hotel Bookings', icon: 'hotel' },
  { href: '/admin/vehicle-rentals', label: 'Vehicle Rentals', icon: 'car' },
  { href: '/admin/visa-applications', label: 'Visa Applications', icon: 'visa' },
  { href: '/admin/visa-services', label: 'Visa Services', icon: 'visa' },
  { href: '/admin/visa-incentives', label: 'Staff Incentives & Payouts', icon: 'wallet' },
  { href: '/admin/visa-reports', label: 'Visa Reports', icon: 'invoice' },
  { href: '/admin/corporate-travel', label: 'Corporate Travel', icon: 'corporate' },
  { href: '/admin/hajj-packages', label: 'Hajj Packages', icon: 'hajj' },
  { href: '/admin/umrah-packages', label: 'Umrah Packages', icon: 'umrah' },
  { href: '/admin/invoices', label: 'Invoices', icon: 'invoice' },
  { href: '/admin/manual-payments', label: 'Manual Payments', icon: 'payment' },
  { href: '/admin/wallets', label: 'Wallets', icon: 'wallet' },
  { href: '/admin/notifications', label: 'Notifications', icon: 'bell' },
  { href: '/admin/roles', label: 'Roles', icon: 'shield' },
  { href: '/admin/integrations', label: 'Integrations', icon: 'plug' },
  { href: '/admin/account', label: 'My Account', icon: 'account' },
];

/** Finance Officer lands on a narrower nav focused on invoicing/payments. */
export const FINANCE_NAV: NavLink[] = [
  { href: '/finance/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { href: '/admin/invoices', label: 'Invoices', icon: 'invoice' },
  { href: '/admin/manual-payments', label: 'Manual Payments', icon: 'payment' },
  { href: '/admin/flight-reports', label: 'Flight Reports', icon: 'invoice' },
  { href: '/admin/visa-incentives', label: 'Staff Incentives & Payouts', icon: 'wallet' },
  { href: '/admin/wallets', label: 'Wallets', icon: 'wallet' },
  { href: '/admin/notifications', label: 'Notifications', icon: 'bell' },
  { href: '/admin/account', label: 'My Account', icon: 'account' },
];

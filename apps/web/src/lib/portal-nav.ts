import type { NavLink } from '@/components/AppShell';

export const PORTAL_NAV: NavLink[] = [
  { href: '/portal/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { href: '/portal/profile', label: 'My Profile', icon: 'account' },
  { href: '/portal/family', label: 'Family Members', icon: 'family' },
  { href: '/portal/wallet', label: 'Wallet', icon: 'wallet' },
  { href: '/portal/hajj', label: 'Hajj Packages', icon: 'hajj' },
  { href: '/portal/umrah', label: 'Umrah Packages', icon: 'umrah' },
  { href: '/portal/flights/search', label: 'Book a Flight', icon: 'flight' },
  { href: '/portal/flights', label: 'My Bookings', icon: 'flight' },
  { href: '/portal/invoices', label: 'My Invoices', icon: 'invoice' },
  { href: '/portal/notifications', label: 'Notifications', icon: 'bell' },
];

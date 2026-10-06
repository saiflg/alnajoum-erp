import type { NavLink } from '@/components/AppShell';
import { assignGroups } from './nav-groups';

const PORTAL_LINKS: NavLink[] = [
  { href: '/portal/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { href: '/portal/profile', label: 'My Profile', icon: 'account' },
  { href: '/portal/family', label: 'Family Members', icon: 'family' },
  { href: '/portal/wallet', label: 'Wallet', icon: 'wallet' },
  { href: '/portal/hajj', label: 'Hajj Packages', icon: 'hajj' },
  { href: '/portal/umrah', label: 'Umrah Packages', icon: 'umrah' },
  { href: '/portal/flights/search', label: 'Book a Flight', icon: 'flight' },
  { href: '/portal/flights', label: 'My Bookings', icon: 'flight' },
  { href: '/portal/hotels', label: 'Hotels', icon: 'hotel' },
  { href: '/portal/vehicle-rentals', label: 'Car, Van & Bus', icon: 'car' },
  { href: '/portal/visa', label: 'Visa Applications', icon: 'visa' },
  { href: '/portal/invoices', label: 'My Invoices', icon: 'invoice' },
  { href: '/portal/support', label: 'Support', icon: 'bell' },
  { href: '/portal/notifications', label: 'Notifications', icon: 'bell' },
];

export const PORTAL_NAV: NavLink[] = assignGroups(PORTAL_LINKS, {
  'Travel': ['/portal/flights/search', '/portal/flights', '/portal/hotels', '/portal/vehicle-rentals', '/portal/visa'],
  'Hajj & Umrah': ['/portal/hajj', '/portal/umrah'],
  'My Account': ['/portal/profile', '/portal/family', '/portal/wallet', '/portal/invoices'],
  'Help & Alerts': ['/portal/support', '/portal/notifications'],
});

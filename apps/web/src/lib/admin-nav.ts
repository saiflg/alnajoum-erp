export const ADMIN_NAV = [
  { href: '/admin/dashboard', label: 'Dashboard' },
  { href: '/admin/companies', label: 'Companies' },
  { href: '/admin/branches', label: 'Branches' },
  { href: '/admin/staff', label: 'Staff' },
  { href: '/admin/customers', label: 'Customers' },
  { href: '/admin/flights', label: 'Flight Bookings' },
  { href: '/admin/hajj-packages', label: 'Hajj Packages' },
  { href: '/admin/umrah-packages', label: 'Umrah Packages' },
  { href: '/admin/invoices', label: 'Invoices' },
  { href: '/admin/manual-payments', label: 'Manual Payments' },
  { href: '/admin/wallets', label: 'Wallets' },
  { href: '/admin/notifications', label: 'Notifications' },
  { href: '/admin/roles', label: 'Roles' },
  { href: '/admin/account', label: 'My Account' },
];

/** Finance Officer lands on a narrower nav focused on invoicing/payments. */
export const FINANCE_NAV = [
  { href: '/finance/dashboard', label: 'Dashboard' },
  { href: '/admin/invoices', label: 'Invoices' },
  { href: '/admin/manual-payments', label: 'Manual Payments' },
  { href: '/admin/wallets', label: 'Wallets' },
  { href: '/admin/notifications', label: 'Notifications' },
  { href: '/admin/account', label: 'My Account' },
];

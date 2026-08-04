export const ADMIN_NAV = [
  { href: '/admin/dashboard', label: 'Dashboard' },
  { href: '/admin/companies', label: 'Companies' },
  { href: '/admin/branches', label: 'Branches' },
  { href: '/admin/staff', label: 'Staff' },
  { href: '/admin/customers', label: 'Customers' },
  { href: '/admin/flights', label: 'Flight Bookings' },
  { href: '/admin/invoices', label: 'Invoices' },
  { href: '/admin/roles', label: 'Roles' },
];

/** Finance Officer lands on a narrower nav focused on invoicing/payments. */
export const FINANCE_NAV = [
  { href: '/finance/dashboard', label: 'Dashboard' },
  { href: '/admin/invoices', label: 'Invoices' },
];

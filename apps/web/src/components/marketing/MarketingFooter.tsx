import Link from 'next/link';

const SERVICE_LINKS = [
  { href: '/services#flights', label: 'Flight Booking' },
  { href: '/services#family', label: 'Family Travel' },
  { href: '/services#hotels', label: 'Hotels (Coming Soon)' },
  { href: '/services#visa', label: 'Visa Assistance (Coming Soon)' },
  { href: '/services#hajj', label: 'Hajj & Umrah (Coming Soon)' },
  { href: '/services#corporate', label: 'Corporate Travel (Coming Soon)' },
];

const COMPANY_LINKS = [
  { href: '/about', label: 'About Us' },
  { href: '/contact', label: 'Contact' },
  { href: '/login', label: 'Sign In' },
  { href: '/register', label: 'Create an Account' },
];

// Legal pages ship with generic starting content — see each page for the
// "review before production" note. Update as the business's real policies
// are finalized.
const LEGAL_LINKS = [
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/terms', label: 'Terms of Service' },
];

// Placeholder destinations — swap in the agency's real social profile URLs
// once they exist. Left as "#" rather than removed, so the footer layout
// and icons are ready to go the moment real links are available.
const SOCIAL_LINKS = [
  {
    href: '#',
    label: 'Facebook',
    icon: (
      <path d="M13.5 21v-7.5h2.5l.4-3H13.5V8.5c0-.87.24-1.46 1.49-1.46h1.6V4.36C16.3 4.25 15.3 4.15 14.16 4.15c-2.4 0-4.04 1.46-4.04 4.15v2.35H7.6v3h2.52V21h3.38Z" />
    ),
  },
  {
    href: '#',
    label: 'Instagram',
    icon: (
      <>
        <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17" cy="7" r="1" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    href: '#',
    label: 'X (Twitter)',
    icon: <path d="M4 4l16 16M20 4L4 20" strokeLinecap="round" />,
  },
  {
    href: '#',
    label: 'WhatsApp',
    icon: (
      <path d="M12 4a8 8 0 0 0-6.9 12.03L4 20l4.1-1.07A8 8 0 1 0 12 4Zm0 14.4a6.36 6.36 0 0 1-3.24-.89l-.23-.14-2.42.63.65-2.36-.15-.24A6.4 6.4 0 1 1 12 18.4Z" />
    ),
  },
];

const BUSINESS_HOURS = [
  { day: 'Monday – Friday', hours: '8:00 AM – 6:00 PM' },
  { day: 'Saturday', hours: '9:00 AM – 3:00 PM' },
  { day: 'Sunday', hours: 'Closed' },
];

export function MarketingFooter() {
  return (
    <footer className="border-t border-slate-200 bg-slate-900 text-slate-300">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-2 lg:grid-cols-5 lg:px-8">
        <div className="lg:col-span-1">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-sm font-bold text-slate-900">
              AT
            </span>
            <span className="text-lg font-semibold text-white">Alnajoum Travel</span>
          </div>
          <p className="mt-4 max-w-xs text-sm text-slate-400">
            Flights, family travel, and (soon) hotels, visas, and Hajj &amp; Umrah packages —
            all in one place, built for travelers in Nigeria and beyond.
          </p>
          <ul className="mt-5 flex items-center gap-3">
            {SOCIAL_LINKS.map((social) => (
              <li key={social.label}>
                <a
                  href={social.href}
                  aria-label={social.label}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-700 text-slate-400 transition hover:border-amber-400 hover:text-amber-400"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                  >
                    {social.icon}
                  </svg>
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-white">Services</h3>
          <ul className="mt-4 space-y-3">
            {SERVICE_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="text-sm text-slate-400 hover:text-white">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-white">Company</h3>
          <ul className="mt-4 space-y-3">
            {COMPANY_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="text-sm text-slate-400 hover:text-white">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <h3 className="mt-6 text-sm font-semibold text-white">Legal</h3>
          <ul className="mt-4 space-y-3">
            {LEGAL_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="text-sm text-slate-400 hover:text-white">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-white">Get in touch</h3>
          <ul className="mt-4 space-y-3 text-sm text-slate-400">
            <li>
              <a href="mailto:info@alnajoum.travel" className="hover:text-white">
                info@alnajoum.travel
              </a>
            </li>
            <li>
              <a href="tel:+2348000000000" className="hover:text-white">
                +234 (0) 800 000 0000
              </a>
            </li>
            <li>Lagos, Nigeria</li>
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-white">Business hours</h3>
          <ul className="mt-4 space-y-3 text-sm text-slate-400">
            {BUSINESS_HOURS.map((row) => (
              <li key={row.day} className="flex justify-between gap-4">
                <span>{row.day}</span>
                <span className="text-slate-300">{row.hours}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="border-t border-slate-800 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 text-xs text-slate-500 sm:flex-row">
          <p>© {new Date().getFullYear()} Alnajoum Travel. All rights reserved.</p>
          <div className="flex gap-5">
            {LEGAL_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="hover:text-slate-300">
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}

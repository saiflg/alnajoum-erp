/**
 * Hand-built line/fill icon set for the sidebar nav — kept dependency-free
 * (no icon package) rather than pulling in a library for ~15 glyphs.
 * Each icon is a self-contained 24x24 <svg>; consumers just set width/height
 * via className and the color follows `currentColor` from the parent.
 */

export type NavIconName =
  | 'dashboard'
  | 'company'
  | 'branch'
  | 'staff'
  | 'customer'
  | 'flight'
  | 'hajj'
  | 'umrah'
  | 'invoice'
  | 'payment'
  | 'wallet'
  | 'bell'
  | 'shield'
  | 'account'
  | 'family';

const ICON_PATHS: Record<NavIconName, React.ReactNode> = {
  dashboard: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  company: (
    <>
      <rect x="4.5" y="2.5" width="15" height="19" rx="1" />
      <rect x="8" y="6.5" width="2" height="2" fill="currentColor" stroke="none" />
      <rect x="14" y="6.5" width="2" height="2" fill="currentColor" stroke="none" />
      <rect x="8" y="11" width="2" height="2" fill="currentColor" stroke="none" />
      <rect x="14" y="11" width="2" height="2" fill="currentColor" stroke="none" />
      <rect x="9.5" y="15.5" width="5" height="6" />
    </>
  ),
  branch: (
    <>
      <path d="M12 21s-7-7.58-7-13a7 7 0 1 1 14 0c0 5.42-7 13-7 13Z" strokeLinejoin="round" />
      <circle cx="12" cy="8" r="2.5" />
    </>
  ),
  staff: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20c0-3.6 2.46-6 5.5-6s5.5 2.4 5.5 6" strokeLinecap="round" />
      <circle cx="17" cy="9" r="2.25" />
      <path d="M15 13.5c2.2.4 3.8 2.2 3.8 5.5" strokeLinecap="round" />
    </>
  ),
  customer: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 21c0-4.14 3.36-7.5 7.5-7.5s7.5 3.36 7.5 7.5" strokeLinecap="round" />
    </>
  ),
  flight: (
    <path
      fill="currentColor"
      stroke="none"
      d="M22 16.5v-2l-8.5-5V4a1.5 1.5 0 0 0-3 0v5.5L2 14.5v2l8.5-2.6V19l-2.5 1.8V22l3.5-1 3.5 1v-1.2L12.5 19v-5.1z"
    />
  ),
  hajj: (
    <>
      <rect x="5" y="7" width="14" height="13" rx="0.5" strokeLinejoin="round" />
      <path d="M5 11h14" />
      <path d="M12 2v5" strokeLinecap="round" />
    </>
  ),
  umrah: (
    <path
      fill="currentColor"
      stroke="none"
      d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"
    />
  ),
  invoice: (
    <>
      <path d="M6 2.5h9l3 3V21a.5.5 0 0 1-.5.5H6a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5Z" strokeLinejoin="round" />
      <path d="M9 9h6M9 13h6M9 17h4" strokeLinecap="round" />
    </>
  ),
  payment: (
    <>
      <rect x="2.5" y="6" width="19" height="13" rx="2" />
      <path d="M2.5 10h19" />
      <rect x="5" y="13.5" width="4" height="2.2" rx="0.5" fill="currentColor" stroke="none" />
    </>
  ),
  wallet: (
    <>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h11A2.5 2.5 0 0 1 19 7.5V8H5.5A2.5 2.5 0 0 1 3 5.5v2Z" strokeLinejoin="round" />
      <rect x="3" y="8" width="18" height="11.5" rx="2" />
      <circle cx="16.5" cy="13.75" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  bell: (
    <>
      <path
        d="M6 10a6 6 0 1 1 12 0c0 3.2 1 4.8 1.6 5.6.3.4 0 1-.5 1H4.9c-.5 0-.8-.6-.5-1C5 14.8 6 13.2 6 10Z"
        strokeLinejoin="round"
      />
      <path d="M9.5 19a2.5 2.5 0 0 0 5 0" strokeLinecap="round" />
    </>
  ),
  shield: (
    <>
      <path d="M12 2.5 4.5 5.5V11c0 5.2 3.2 8.7 7.5 10.5 4.3-1.8 7.5-5.3 7.5-10.5V5.5L12 2.5Z" strokeLinejoin="round" />
      <path d="M8.5 12l2.3 2.3L15.5 9.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  account: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="10" r="3" />
      <path d="M6 19c.8-2.8 3.1-4.5 6-4.5s5.2 1.7 6 4.5" strokeLinecap="round" />
    </>
  ),
  family: (
    <>
      <circle cx="12" cy="7" r="3" />
      <circle cx="5.5" cy="9" r="2.2" />
      <circle cx="18.5" cy="9" r="2.2" />
      <path d="M12 12c-3 0-5.5 2.2-5.5 6.5h11C17.5 14.2 15 12 12 12Z" strokeLinejoin="round" />
      <path d="M5.5 12c-2 0-3.5 1.8-3.5 5" strokeLinecap="round" />
      <path d="M18.5 12c2 0 3.5 1.8 3.5 5" strokeLinecap="round" />
    </>
  ),
};

export function NavIcon({ name, className }: { name: NavIconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

export function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MenuIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M3 6h18M3 12h18M3 18h18" strokeLinecap="round" />
    </svg>
  );
}

export function CloseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  );
}

export function LogoutIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 17l5-5-5-5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 12H9" strokeLinecap="round" />
    </svg>
  );
}

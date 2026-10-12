import type { Metadata } from 'next';

// A verification link is for the person holding the card: it must not be indexed, and nothing from it should be
// passed on to other sites.
export const metadata: Metadata = {
  title: 'Verify a staff identification card',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function VerifyLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

import type { Metadata } from 'next';

// A link from a message identifies one person's subscription: it must not be indexed, and nothing from it should be
// passed on to other sites.
export const metadata: Metadata = {
  title: 'Your subscription',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function TokenLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

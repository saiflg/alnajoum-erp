import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Travel offers and updates',
  description: 'Choose how you would like to hear from Alnajoum Travel Agency.',
};

export default function SubscribeLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

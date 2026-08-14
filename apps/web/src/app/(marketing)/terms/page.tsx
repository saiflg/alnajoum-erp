import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service — Alnajoum Travel',
};

const SECTIONS = [
  {
    title: '1. Acceptance of these terms',
    body: [
      'By creating an account or using any part of the Alnajoum Travel platform, you agree to these Terms of Service. If you do not agree, please do not use the platform.',
    ],
  },
  {
    title: '2. Who can use this platform',
    body: [
      'You must provide accurate information when registering, and keep your account credentials confidential. You are responsible for all activity that happens under your account.',
      'You may add family members to your account to manage their profiles and bookings on their behalf; you confirm you have the authority to do so, particularly for minors.',
    ],
  },
  {
    title: '3. Bookings',
    body: [
      'Flight offers shown on the platform are quotes at the time of search and are not guaranteed until a booking is confirmed. Prices, availability, and schedules can change between search and booking.',
      'A booking is confirmed once you receive a booking reference and confirmation notification. It is your responsibility to check that passenger names, dates, and routes match your travel documents exactly.',
    ],
  },
  {
    title: '4. Invoicing and payment',
    body: [
      'An invoice is generated automatically when a booking is confirmed. Payment can currently be recorded by our staff (cash, bank transfer, POS, or card) against your invoice; online self-service payment will be added as the platform grows.',
      'A booking is not guaranteed to be honored by the airline until the associated invoice is paid in full, in line with standard travel industry practice.',
    ],
  },
  {
    title: '5. Cancellations and refunds',
    body: [
      'Cancellation and refund terms depend on the fare rules of the specific flight booked, which are disclosed at the time of booking where available. Contact us as early as possible if you need to cancel or change a booking.',
    ],
  },
  {
    title: '6. Documents you upload',
    body: [
      'Identity and travel documents (passport, national ID, visa, and similar) that you upload must be genuine and belong to you or the family member you are uploading them for. Do not upload documents belonging to someone else without their consent.',
    ],
  },
  {
    title: '7. Acceptable use',
    body: [
      'Do not attempt to access another customer’s account or data, interfere with the platform’s normal operation, or use the platform for any unlawful purpose.',
    ],
  },
  {
    title: '8. Limitation of liability',
    body: [
      'Alnajoum Travel acts as a booking intermediary between you and airlines and other travel suppliers. We are not liable for flight delays, cancellations, or schedule changes caused by an airline or other third-party supplier, though we will assist you in resolving issues where we reasonably can.',
    ],
  },
  {
    title: '9. Changes to these terms',
    body: [
      'We may update these terms from time to time as the platform grows. Continued use of the platform after a change constitutes acceptance of the updated terms.',
    ],
  },
  {
    title: '10. Governing law',
    body: ['These terms are governed by the laws of the Federal Republic of Nigeria.'],
  },
  {
    title: '11. Contact us',
    body: [
      'Questions about these terms can be sent to info@alnajoum.travel or through the contact form on this site.',
    ],
  },
];

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6 lg:px-8">
      <span className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-4 py-1.5 text-xs font-medium text-amber-700">
        Legal
      </span>
      <h1 className="mt-6 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
        Terms of Service
      </h1>
      <p className="mt-3 text-sm text-slate-500">Last updated: 14 August 2026</p>
      <p className="mt-6 text-sm text-slate-500">
        This is a starting set of terms for Alnajoum Travel and should be
        reviewed by qualified legal counsel before relying on it for a live,
        production service.
      </p>

      <div className="mt-10 space-y-10">
        {SECTIONS.map((section) => (
          <section key={section.title}>
            <h2 className="text-lg font-semibold text-slate-900">{section.title}</h2>
            <div className="mt-3 space-y-3">
              {section.body.map((paragraph, i) => (
                <p key={i} className="text-sm leading-6 text-slate-600">
                  {paragraph}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — Alnajoum Travel',
};

const SECTIONS = [
  {
    title: '1. What this policy covers',
    body: [
      'This Privacy Policy explains how Alnajoum Travel ("we", "us", "our") collects, uses, stores, and protects the personal data of visitors to this website and users of our booking platform, in line with the Nigeria Data Protection Act 2023 (NDPA) and the Nigeria Data Protection Regulation (NDPR).',
      'It applies to customers, family members added to a customer account, and anyone who submits the contact form, even without creating an account.',
    ],
  },
  {
    title: '2. Information we collect',
    body: [
      'Account information: full name, email address, phone number, and password (stored as a salted hash, never in plain text).',
      'Profile information: date of birth, nationality, gender, address, and passport or national ID number, where you choose to provide it for booking purposes.',
      'Identity documents: passport, national ID, visa, photo, vaccination certificate, or birth certificate files you upload for yourself or a family member you manage.',
      'Booking and payment records: flights searched and booked, invoices issued, and payments recorded against your account (payment method and amount; we do not store full card numbers).',
      'Contact form submissions: the name, email, subject, and message you provide when writing to us, even if you never register an account.',
      'Technical information: standard web server logs (IP address, browser type, pages visited) collected automatically for security and reliability.',
    ],
  },
  {
    title: '3. How we use your information',
    body: [
      'To create and manage your account, and your family members’ records, on the platform.',
      'To search for and book flights on your behalf, and to generate and track invoices and payments for those bookings.',
      'To send you transactional notifications: booking confirmations, payment receipts, and — for staff accounts — temporary login credentials.',
      'To respond to messages sent through the contact form.',
      'To detect and prevent fraud, abuse, and unauthorized access to accounts.',
      'We do not sell personal data, and we do not use it for third-party advertising.',
    ],
  },
  {
    title: '4. Who we share it with',
    body: [
      'Flight providers, to search for and confirm bookings on your behalf.',
      'Payment processors, once online payment is enabled, to process transactions you initiate.',
      'Email/SMS delivery providers, to send booking confirmations, receipts, and account notifications.',
      'We do not share your data with third parties for their own marketing purposes.',
    ],
  },
  {
    title: '5. How long we keep it',
    body: [
      'Account and booking records are retained for as long as your account is active, and for a reasonable period afterward to meet accounting, tax, and legal obligations.',
      'Identity documents you upload are retained only for as long as needed to support the booking or verification they were provided for, or until you request deletion, subject to any legal retention requirement.',
    ],
  },
  {
    title: '6. Your rights',
    body: [
      'Under the NDPA, you have the right to access the personal data we hold about you, request correction of inaccurate data, request deletion where there is no overriding legal reason to keep it, and object to certain processing.',
      'You can view and update most of your own profile and family member information directly from your account. For anything else — including a full data export or deletion request — contact us using the details below.',
    ],
  },
  {
    title: '7. Security',
    body: [
      'Passwords are hashed, not stored in plain text. Access to customer and staff data is controlled by a role-based permission system, so staff only see what their role requires. Uploaded documents are validated for file type and size before storage.',
    ],
  },
  {
    title: '8. Contact us',
    body: [
      'For any question about this policy, or to exercise your data protection rights, contact us at alnajoumtravelagency@gmail.com or through the contact form on this site.',
    ],
  },
];

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6 lg:px-8">
      <span className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-4 py-1.5 text-xs font-medium text-amber-700">
        Legal
      </span>
      <h1 className="mt-6 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
        Privacy Policy
      </h1>
      <p className="mt-3 text-sm text-slate-500">Last updated: 14 August 2026</p>
      <p className="mt-6 text-sm text-slate-500">
        This is a starting policy for Alnajoum Travel and should be reviewed by
        qualified legal counsel before relying on it for a live, production
        service handling real customer data.
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

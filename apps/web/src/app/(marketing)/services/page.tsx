'use client';

import Link from 'next/link';
import { Reveal } from '@/components/marketing/Reveal';

const SERVICES = [
  {
    id: 'flights',
    title: 'Flight Booking',
    status: 'Live',
    summary:
      'Search and book one-way, round-trip, or multi-city flights, self-service or with a staff member booking on your behalf.',
    points: [
      'Real-time search across 6 modeled carriers, with fares that respond to route, date, and cabin class',
      'One-way, round-trip, and multi-city itineraries (up to 6 legs) in a single booking',
      'Book for yourself or any family member on your account',
      'Every confirmed booking generates a matching invoice automatically',
    ],
  },
  {
    id: 'family',
    title: 'Family Travel Management',
    status: 'Live',
    summary:
      'Add spouses, children, and other dependents to your account once, with their own documents on file.',
    points: [
      'Store passport and ID documents per family member, separate from your own',
      'Book flights for any family member without re-entering their details',
      'Passport photo quality is checked automatically on upload',
    ],
  },
  {
    id: 'hotels',
    title: 'Hotel Booking',
    status: 'Live',
    summary:
      'Domestic and international hotel stays, using the same booking-and-invoicing pattern already proven for flights.',
    points: [
      'Search by city, dates, and guest count',
      'Same automatic invoicing flow as flights',
      'Every confirmed stay generates a matching invoice instantly',
    ],
  },
  {
    id: 'vehicles',
    title: 'Car, Van & Bus Rental',
    status: 'Live',
    summary:
      'Self-drive or chauffeur-driven vehicles for any trip — day hire, airport transfers, or group travel by van or bus.',
    points: [
      'Cars, vans, and buses, with or without a driver',
      'Search by pickup city and date/time range',
      'Same real booking and invoicing engine as flights and hotels',
    ],
  },
  {
    id: 'visa',
    title: 'Visa Processing',
    status: 'Coming Soon',
    summary:
      'Document collection and application status tracking for visa applications.',
    points: [
      'Reuses the existing passport/document upload pipeline',
      'Staff-visible status tracking per application',
      'Notifications on status changes',
    ],
  },
  {
    id: 'hajj',
    title: 'Hajj & Umrah Packages',
    status: 'Live',
    summary:
      'End-to-end pilgrimage packages for Nigerian pilgrims traveling to Makkah and Madinah.',
    points: [
      'Browse published Hajj and Umrah packages with live seat availability and pricing',
      'Register yourself and any family member on the same booking, with a per-pilgrim invoice breakdown',
      'Pay in installments — by card, bank transfer, or wallet balance — against a single tracked invoice',
      'Automatic reminders for outstanding installments and missing travel documents',
    ],
  },
  {
    id: 'corporate',
    title: 'Corporate Travel',
    status: 'Coming Soon',
    summary:
      'Company-managed booking and consolidated invoicing for business travel.',
    points: [
      'Company-level booking on behalf of staff travelers',
      'Consolidated invoicing per company or per branch',
      'Built on the existing Company/Branch/Staff structure',
    ],
  },
];

export default function ServicesPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-20 sm:px-6 lg:px-8">
      <Reveal className="text-center">
        <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          Our services
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600">
          Flights, hotels, car/van/bus rental, family travel, and Hajj &amp; Umrah packages
          are live and bookable today. Everything else is on our roadmap, built on the
          same real infrastructure.
        </p>
      </Reveal>

      <div className="mt-16 space-y-6">
        {SERVICES.map((service, i) => (
          <Reveal key={service.id} delay={Math.min(i, 3) * 0.06}>
            <div
              id={service.id}
              className="scroll-mt-24 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-2xl font-semibold text-slate-900">{service.title}</h2>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    service.status === 'Live'
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {service.status}
                </span>
              </div>
              <p className="mt-3 text-slate-600">{service.summary}</p>
              <ul className="mt-5 space-y-2">
                {service.points.map((point) => (
                  <li key={point} className="flex items-start gap-2 text-sm text-slate-600">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                    {point}
                  </li>
                ))}
              </ul>
              {service.status === 'Live' && (
                <Link
                  href="/register"
                  className="mt-6 inline-block rounded-full bg-slate-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
                >
                  Get started
                </Link>
              )}
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

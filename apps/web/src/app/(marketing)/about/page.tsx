'use client';

import Image from 'next/image';
import { Reveal } from '@/components/marketing/Reveal';

const VALUES = [
  {
    title: 'Built on a real platform',
    body: 'Every feature you see — bookings, invoices, payments — runs on the same production-grade API our staff use internally. Nothing here is a mockup.',
  },
  {
    title: 'Transparent by default',
    body: 'You can always see exactly what you owe, what you’ve paid, and the status of every booking — no phone calls required.',
  },
  {
    title: 'Family-first design',
    body: 'Travel in Nigeria is rarely solo. We built family and dependent management as a first-class feature, not an afterthought.',
  },
  {
    title: 'Growing deliberately',
    body: 'We ship one module at a time, fully tested, rather than promising everything at once. Flights, hotels, car/van/bus rental, family travel, Hajj & Umrah packages, visa processing, and corporate travel are all live.',
  },
];

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-20 sm:px-6 lg:px-8">
      <Reveal className="text-center">
        <Image
          src="/brand/logo-full.png"
          alt="Alnajoum Travel Agency — Making Travel Easy For You"
          width={900}
          height={449}
          className="mx-auto h-auto w-full max-w-md"
          priority
        />
        <span className="mt-6 inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-4 py-1.5 text-xs font-medium text-amber-700">
          About Alnajoum Travel Agency
        </span>
        <h1 className="mt-6 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          Your journey, our priority
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600">
          Alnajoum Travel Agency Limited is an IATA- and TAAN-accredited travel agency
          based in Kaduna, Nigeria (RC: 6860328), offering flight tickets on all major
          airlines, Hajj &amp; Umrah visa processing, hotels, travel insurance, and tours.
          This platform is how we&apos;re bringing that same service online: real
          accounts, real bookings, real invoices.
        </p>
      </Reveal>

      <Reveal delay={0.1} className="mt-16 rounded-2xl border border-slate-200 bg-slate-50 p-8">
        <h2 className="text-xl font-semibold text-slate-900">Our story</h2>
        <p className="mt-4 text-slate-600">
          Alnajoum Travel Agency has spent years booking flights, processing Hajj and
          Umrah visas, and arranging hotels and tours for travelers out of Kaduna. We
          started building this platform by asking a simple question: why do travel
          bookings, family records, and invoicing usually live in three different
          systems that don&apos;t talk to each other? This ERP exists to close that
          gap — a single platform where a customer&apos;s profile, their family
          members, their bookings, and their invoices are always in sync, and where
          staff only ever see what their role allows them to.
        </p>
      </Reveal>

      <div className="mt-16 grid gap-6 sm:grid-cols-2">
        {VALUES.map((value, i) => (
          <Reveal key={value.title} delay={i * 0.08}>
            <div className="h-full rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-base font-semibold text-slate-900">{value.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{value.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

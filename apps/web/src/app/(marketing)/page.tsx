'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { AnimatedCounter } from '@/components/marketing/AnimatedCounter';
import { DestinationSlider } from '@/components/marketing/DestinationSlider';
import { FlightSearchTeaser } from '@/components/marketing/FlightSearchTeaser';
import { Marquee } from '@/components/marketing/Marquee';
import { Reveal } from '@/components/marketing/Reveal';
import { ServiceSlider } from '@/components/marketing/ServiceSlider';
import { TransportBackdrop } from '@/components/marketing/TransportBackdrop';

const TRUST_ITEMS = [
  'IATA Accredited',
  'TAAN Member',
  'RC: 6860328',
  'All Airlines Ticketing',
  'Hajj & Umrah Visas',
  'Hotels',
  'Tours',
  'Travel Insurance',
  'Kaduna, Nigeria',
];

const STATS = [
  { target: 9, suffix: '', label: 'Core modules live today' },
  { target: 6, suffix: '', label: 'Nigerian & partner airlines' },
  { target: 100, suffix: '%', label: 'Bookings backed by a real API' },
  { target: 24, suffix: '/7', label: 'Portal access, anywhere' },
];

const SERVICES = [
  {
    id: 'flights',
    title: 'Flight Booking',
    status: 'Live',
    description:
      'Search and book one-way, round-trip, or multi-city flights across major Nigerian and international carriers, with an auto-generated invoice the moment your booking is confirmed.',
    icon: (
      <path d="M22 16.5v-2l-8.5-5V4a1.5 1.5 0 0 0-3 0v5.5L2 14.5v2l8.5-2.6V19l-2.5 1.8V22l3.5-1 3.5 1v-1.2L12.5 19v-5.1z" />
    ),
  },
  {
    id: 'family',
    title: 'Family Travel Management',
    status: 'Live',
    description:
      'Add dependents to your profile once, keep their documents on file, and book flights for the whole family without re-entering their details every time.',
    icon: (
      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
    ),
  },
  {
    id: 'hotels',
    title: 'Hotel Booking',
    status: 'Live',
    description:
      'Domestic and international hotel stays, booked and invoiced the same way flights are — search by city, dates, and guest count, confirmed instantly.',
    icon: (
      <path d="M7 13c1.66 0 3-1.34 3-3S8.66 7 7 7s-3 1.34-3 3 1.34 3 3 3zm12-6h-8v7H3V5H1v15h2v-3h18v3h2v-9c0-2.21-1.79-4-4-4z" />
    ),
  },
  {
    id: 'vehicles',
    title: 'Car, Van & Bus Rental',
    status: 'Live',
    description:
      'Self-drive or chauffeur-driven cars, vans, and buses for any trip — the same real booking and invoicing engine as flights and hotels.',
    icon: (
      <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1h12v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-8l-2.08-5.99ZM6.5 16A1.5 1.5 0 1 1 8 14.5 1.5 1.5 0 0 1 6.5 16Zm11 0a1.5 1.5 0 1 1 1.5-1.5 1.5 1.5 0 0 1-1.5 1.5ZM5 11l1.5-4.5h11L19 11H5Z" />
    ),
  },
  {
    id: 'visa',
    title: 'Visa Processing',
    status: 'Live',
    description:
      'Submit a visa application and track its status from your portal, from document review to issuance — built on the same passport/document upload pipeline already live for customer profiles.',
    icon: (
      <path d="M20 3H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zM9 17H7v-7h2zm4 0h-2V7h2zm4 0h-2v-4h2z" />
    ),
  },
  {
    id: 'hajj',
    title: 'Hajj & Umrah Packages',
    status: 'Live',
    description:
      'Register yourself and any family member on a published Hajj or Umrah package, then pay in installments — by card, bank transfer, or wallet — against a per-pilgrim invoice.',
    icon: (
      <path d="M12 2 4 7v2h16V7zM4 11v9h4v-6h8v6h4v-9z" />
    ),
  },
  {
    id: 'corporate',
    title: 'Corporate Travel',
    status: 'Live',
    description:
      'Company-managed booking and consolidated invoicing for organizations sending staff on business travel — one itemized invoice per booking, arranged through your account manager.',
    icon: (
      <path d="M12 7V3H2v18h20V7zM6 19H4v-2h2zm0-4H4v-2h2zm0-4H4V9h2zm0-4H4V5h2zm4 12H8v-2h2zm0-4H8v-2h2zm0-4H8V9h2zm0-4H8V5h2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8zm-2-8h-2v2h2zm0 4h-2v2h2z" />
    ),
  },
];

const DESTINATIONS = [
  {
    city: 'Lagos',
    country: 'Nigeria',
    code: 'LOS',
    gradient: 'from-amber-500 to-orange-600',
    landmark: (
      <>
        <rect x="8" y="32" width="10" height="23" />
        <rect x="20" y="20" width="10" height="35" />
        <rect x="32" y="28" width="10" height="27" />
        <rect x="44" y="15" width="10" height="40" />
        <rect x="56" y="25" width="10" height="30" />
        <rect x="68" y="33" width="10" height="22" />
        <rect x="80" y="22" width="10" height="33" />
      </>
    ),
  },
  {
    city: 'Abuja',
    country: 'Nigeria',
    code: 'ABV',
    gradient: 'from-emerald-500 to-teal-600',
    landmark: (
      <>
        <rect x="30" y="15" width="8" height="40" />
        <rect x="62" y="15" width="8" height="40" />
        <rect x="30" y="15" width="40" height="8" />
      </>
    ),
  },
  {
    city: 'Jeddah',
    country: 'Saudi Arabia',
    code: 'JED',
    gradient: 'from-slate-600 to-slate-800',
    landmark: (
      <>
        <circle cx="50" cy="30" r="14" />
        <rect x="44" y="30" width="12" height="25" />
        <rect x="15" y="20" width="6" height="35" />
        <polygon points="12,20 24,20 18,10" />
        <rect x="79" y="20" width="6" height="35" />
        <polygon points="76,20 88,20 82,10" />
      </>
    ),
  },
  {
    city: 'Dubai',
    country: 'UAE',
    code: 'DXB',
    gradient: 'from-sky-500 to-blue-700',
    landmark: (
      <>
        <polygon points="46,55 54,55 52,10 48,10" />
        <rect x="30" y="45" width="40" height="10" />
      </>
    ),
  },
  {
    city: 'London',
    country: 'United Kingdom',
    code: 'LHR',
    gradient: 'from-indigo-500 to-violet-700',
    landmark: (
      <>
        <rect x="40" y="15" width="20" height="40" />
        <circle cx="50" cy="25" r="6" fillOpacity="0.5" />
        <polygon points="38,15 62,15 50,5" />
      </>
    ),
  },
  {
    city: 'Cairo',
    country: 'Egypt',
    code: 'CAI',
    gradient: 'from-yellow-600 to-amber-800',
    landmark: (
      <>
        <polygon points="20,55 35,25 50,55" />
        <polygon points="45,55 60,20 75,55" />
        <polygon points="65,55 78,32 91,55" />
      </>
    ),
  },
];

const TESTIMONIALS = [
  {
    name: 'Amina B.',
    role: 'Family traveler',
    quote:
      'Booking for myself and my kids used to mean re-typing passport details every single time. Now I add them once and every future booking just works.',
  },
  {
    name: 'Tunde O.',
    role: 'Frequent flyer',
    quote:
      'I can see my invoice and payment status the moment a flight is confirmed — no waiting on a call back to know what I owe.',
  },
  {
    name: 'Chidinma A.',
    role: 'Corporate travel coordinator',
    quote:
      'Having staff and customer accounts on one platform, with proper role permissions, is exactly what our back office needed.',
  },
];

function FadeIn({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

export default function MarketingHomePage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-slate-900 pb-28 pt-20 sm:pb-36 sm:pt-28">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              'radial-gradient(60% 50% at 50% 0%, rgba(245,158,11,0.25) 0%, rgba(15,23,42,0) 70%)',
          }}
        />
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -right-24 top-24 h-72 w-72 rounded-full bg-amber-500/10 blur-3xl"
          animate={{ y: [0, 20, 0] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -left-24 top-64 h-72 w-72 rounded-full bg-sky-500/10 blur-3xl"
          animate={{ y: [0, -20, 0] }}
          transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
        />
        <TransportBackdrop />

        <div className="relative mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
          <FadeIn>
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-4 py-1.5 text-xs font-medium text-amber-300">
              IATA &amp; TAAN accredited · Kaduna, Nigeria
            </span>
          </FadeIn>
          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            className="mt-6 text-4xl font-bold tracking-tight text-white sm:text-6xl"
          >
            Your journey,
            <span className="text-amber-400"> our priority.</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="mx-auto mt-6 max-w-2xl text-lg text-slate-300"
          >
            Alnajoum Travel Agency brings flights, family travel, invoicing, and
            payments into one platform — real accounts, real bookings, real invoices,
            not a demo.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
          >
            <Link
              href="/register"
              className="rounded-full bg-amber-500 px-7 py-3 text-sm font-semibold text-slate-900 shadow-lg shadow-amber-500/30 transition-transform hover:scale-105 hover:bg-amber-400"
            >
              Create your free account
            </Link>
            <Link
              href="/services"
              className="rounded-full border border-white/20 px-7 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              Explore services
            </Link>
          </motion.div>

          <FlightSearchTeaser />
        </div>
      </section>

      {/* Trust marquee */}
      <section className="border-b border-slate-800 bg-slate-900 py-4">
        <Marquee
          items={TRUST_ITEMS.map((item) => (
            <span key={item} className="flex items-center gap-3 text-sm font-medium text-slate-400">
              <span aria-hidden className="h-1 w-1 rounded-full bg-amber-400" />
              {item}
            </span>
          ))}
        />
      </section>

      {/* Service slider */}
      <section className="bg-white py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <ServiceSlider />
        </div>
      </section>

      {/* Stats */}
      <section className="border-b border-slate-100 bg-white py-14">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-4 sm:px-6 md:grid-cols-4 lg:px-8">
          {STATS.map((stat, i) => (
            <Reveal key={stat.label} delay={i * 0.08} className="text-center">
              <p className="text-3xl font-bold text-slate-900 sm:text-4xl">
                <AnimatedCounter target={stat.target} suffix={stat.suffix} />
              </p>
              <p className="mt-1 text-sm text-slate-500">{stat.label}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Services */}
      <section id="services" className="bg-slate-50 py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <Reveal className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Everything a modern travel agency needs
            </h2>
            <p className="mt-4 text-slate-600">
              Flights, hotels, car/van/bus rental, family travel, Hajj &amp; Umrah packages,
              visa processing, and corporate travel are all live today, running on the same
              real booking and invoicing engine end to end.
            </p>
          </Reveal>

          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {SERVICES.map((service, i) => (
              <Reveal key={service.id} delay={(i % 3) * 0.08}>
                <motion.div
                  whileHover={{ y: -6 }}
                  transition={{ duration: 0.25 }}
                  className="group h-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-lg"
                >
                  <div className="flex items-start justify-between">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 text-amber-400">
                      <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                        {service.icon}
                      </svg>
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        service.status === 'Live'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {service.status}
                    </span>
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-slate-900">
                    {service.title}
                  </h3>
                  <p className="mt-2 text-sm text-slate-600">{service.description}</p>
                </motion.div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Why choose us */}
      <section className="bg-white py-24">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
          <Reveal>
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Why travelers choose Alnajoum
            </h2>
            <p className="mt-4 max-w-lg text-slate-600">
              We built the booking engine first, the marketing after — so what you see
              here is backed by a real, tested API, not static mockups.
            </p>
          </Reveal>

          <div className="grid gap-6 sm:grid-cols-2">
            {[
              {
                title: 'Real invoices, automatically',
                body: 'Every confirmed booking generates an invoice instantly — no manual paperwork, no waiting.',
              },
              {
                title: 'Family accounts, done right',
                body: 'Add dependents once with their documents on file, then book for the whole family in one flow.',
              },
              {
                title: 'Transparent payments',
                body: 'Track exactly what you’ve paid and what’s outstanding on every invoice, in real time.',
              },
              {
                title: 'Role-based staff access',
                body: 'From branch managers to finance officers, every staff role sees exactly what they need — nothing more.',
              },
            ].map((item, i) => (
              <Reveal key={item.title} delay={i * 0.08}>
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-5">
                  <h3 className="text-sm font-semibold text-slate-900">{item.title}</h3>
                  <p className="mt-2 text-sm text-slate-600">{item.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Destinations */}
      <section className="bg-slate-50 py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <Reveal className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Popular destinations
            </h2>
            <p className="mt-4 text-slate-600">
              A sample of routes searchable today through the live mock provider —
              swap in real fares the moment airline API credentials are connected.
            </p>
          </Reveal>

          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {DESTINATIONS.map((dest, i) => (
              <Reveal key={dest.city} delay={(i % 3) * 0.08}>
                <DestinationSlider
                  city={dest.city}
                  country={dest.country}
                  code={dest.code}
                  gradient={dest.gradient}
                  landmark={dest.landmark}
                  delay={i * 400}
                />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="bg-white py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <Reveal className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              What travelers are saying
            </h2>
          </Reveal>

          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {TESTIMONIALS.map((t, i) => (
              <Reveal key={t.name} delay={i * 0.08}>
                <div className="h-full rounded-2xl border border-slate-100 bg-slate-50 p-6">
                  <p className="text-sm leading-relaxed text-slate-700">“{t.quote}”</p>
                  <p className="mt-4 text-sm font-semibold text-slate-900">{t.name}</p>
                  <p className="text-xs text-slate-500">{t.role}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-slate-900 py-24">
        <Reveal className="mx-auto max-w-2xl px-4 text-center sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            Ready to start your journey?
          </h2>
          <p className="mt-4 text-slate-300">
            Create an account in under a minute and book your first flight today.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/register"
              className="rounded-full bg-amber-500 px-7 py-3 text-sm font-semibold text-slate-900 shadow-lg shadow-amber-500/30 transition-transform hover:scale-105 hover:bg-amber-400"
            >
              Get Started Free
            </Link>
            <Link
              href="/contact"
              className="rounded-full border border-white/20 px-7 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              Talk to us
            </Link>
          </div>
        </Reveal>
      </section>
    </>
  );
}

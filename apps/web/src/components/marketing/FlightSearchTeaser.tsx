'use client';

import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { useAuth } from '@/lib/auth-context';

export function FlightSearchTeaser() {
  const router = useRouter();
  const { user } = useAuth();
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [date, setDate] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams({
      next: '/portal/flights/search',
      origin: origin.toUpperCase(),
      destination: destination.toUpperCase(),
      date,
    });
    // Signed-in visitors go straight to a real search; everyone else
    // registers first — the same origin/destination/date carry through
    // and land them on a prefilled, live search against the real API.
    router.push(`${user ? '/portal/flights/search' : '/register'}?${params.toString()}`);
  }

  return (
    <motion.form
      onSubmit={handleSubmit}
      initial={{ opacity: 0, y: 32 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto mt-10 grid max-w-3xl grid-cols-2 gap-3 rounded-2xl border border-white/10 bg-white/95 p-4 shadow-2xl shadow-slate-900/20 backdrop-blur sm:grid-cols-4 sm:p-5"
    >
      <div className="col-span-1">
        <label className="block text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          From
        </label>
        <input
          required
          maxLength={3}
          placeholder="LOS"
          value={origin}
          onChange={(e) => setOrigin(e.target.value.toUpperCase())}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm uppercase text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
        />
      </div>
      <div className="col-span-1">
        <label className="block text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          To
        </label>
        <input
          required
          maxLength={3}
          placeholder="ABV"
          value={destination}
          onChange={(e) => setDestination(e.target.value.toUpperCase())}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm uppercase text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
        />
      </div>
      <div className="col-span-1">
        <label className="block text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          Depart
        </label>
        <input
          required
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
        />
      </div>
      <div className="col-span-2 flex items-end sm:col-span-1">
        <button
          type="submit"
          className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
        >
          Search Flights
        </button>
      </div>
    </motion.form>
  );
}

'use client';

import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FlightSearchForm } from '@/components/flights/FlightSearchForm';
import { useAuth } from '@/lib/auth-context';
import { defaultSearchState, encodeSearchParams, FlightSearchState } from '@/lib/flight-search';

export function FlightSearchTeaser() {
  const router = useRouter();
  const { user } = useAuth();
  const [search, setSearch] = useState<FlightSearchState>(defaultSearchState);

  function handleSubmit(state: FlightSearchState) {
    const params = encodeSearchParams(state);
    params.set('next', '/portal/flights/search');
    // Signed-in visitors go straight to a real search; everyone else
    // registers first — the whole search (including every multi-city leg)
    // carries through and lands them on a prefilled, live search.
    router.push(`${user ? '/portal/flights/search' : '/register'}?${params.toString()}`);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto mt-10 max-w-4xl rounded-3xl border border-white/10 bg-white/95 p-5 shadow-2xl shadow-slate-900/25 backdrop-blur sm:p-7"
    >
      <FlightSearchForm
        idPrefix="teaser"
        value={search}
        onChange={setSearch}
        onSubmit={handleSubmit}
        submitLabel="Search flights"
      />
    </motion.div>
  );
}

'use client';

import { motion } from 'framer-motion';
import { ReactNode } from 'react';
import { SceneSlideshow } from './Showcase';

/** Split layout for login/register: animated scene panel beside the form (hidden on small screens). */
export function AuthSplit({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 bg-slate-50">
      <div className="relative hidden w-1/2 overflow-hidden bg-slate-900 lg:block">
        <SceneSlideshow intervalMs={4800} />
        <div className="pointer-events-none absolute inset-x-0 top-0 p-10">
          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-400"
          >
            Alnajoum Travel Agency
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3 }}
            className="mt-3 max-w-sm text-3xl font-bold leading-tight tracking-tight text-white"
          >
            One account for every journey.
          </motion.h2>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center px-4 py-12">{children}</div>
    </div>
  );
}

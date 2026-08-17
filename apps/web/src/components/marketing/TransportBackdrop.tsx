'use client';

import { motion } from 'framer-motion';
import { Marquee } from './Marquee';

const PLANE_PATH =
  'M22 16.5v-2l-8.5-5V4a1.5 1.5 0 0 0-3 0v5.5L2 14.5v2l8.5-2.6V19l-2.5 1.8V22l3.5-1 3.5 1v-1.2L12.5 19v-5.1z';
const TRAIN_PATH =
  'M12 2c-4 0-8 .5-8 4v9.5A3.5 3.5 0 0 0 7.5 19L6 20.5V21h2.2l1.6-1.6h4.4L15.8 21H18v-.5L16.5 19a3.5 3.5 0 0 0 3.5-3.5V6c0-3.5-4-4-8-4zm-5 3h10v6H7zm1.5 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm7 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z';
const BUS_PATH =
  'M4 16c0 .88.39 1.67 1 2.22V20a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1h8v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4zm3.5 1A1.5 1.5 0 1 1 7.5 14a1.5 1.5 0 0 1 0 3zm9 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM6 12V6h12v6z';
const CAR_PATH =
  'M5 11 6.6 6.2A2 2 0 0 1 8.5 5h7a2 2 0 0 1 1.9 1.2L19 11h.5a1.5 1.5 0 0 1 1.5 1.5V16a1 1 0 0 1-1 1h-1.1a2 2 0 0 1-3.8 0H9.9a2 2 0 0 1-3.8 0H5a1 1 0 0 1-1-1v-3.5A1.5 1.5 0 0 1 5.5 11zM7.5 8 6.9 10h10.2L16.5 8zM7 15.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm10 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2z';

const TRANSPORT_ICONS = [
  { label: 'Flights', d: PLANE_PATH },
  { label: 'Trains', d: TRAIN_PATH },
  { label: 'Buses', d: BUS_PATH },
  { label: 'Cars', d: CAR_PATH },
];

/**
 * Purely decorative animated backdrop for the hero: a faint drifting strip
 * of transport icons plus a single plane that flies a slow diagonal loop.
 * All hand-drawn SVG, not stock photography — see the "reachable files"
 * limitation noted in the marketing-site work for why.
 */
export function TransportBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <motion.svg
        viewBox="0 0 24 24"
        fill="currentColor"
        className="absolute h-10 w-10 text-amber-400/30"
        initial={{ top: '18%', left: '-10%', rotate: 35 }}
        animate={{ left: '110%', top: '55%' }}
        transition={{ duration: 16, repeat: Infinity, ease: 'linear', repeatDelay: 2 }}
      >
        <path d={PLANE_PATH} />
      </motion.svg>

      <div className="absolute bottom-6 left-0 right-0 opacity-[0.15]">
        <Marquee
          items={TRANSPORT_ICONS.map((t) => (
            <svg key={t.label} viewBox="0 0 24 24" fill="currentColor" className="h-8 w-8 text-white">
              <path d={t.d} />
            </svg>
          ))}
        />
      </div>
    </div>
  );
}

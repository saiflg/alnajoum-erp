'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';

const PLANE_PATH =
  'M22 16.5v-2l-8.5-5V4a1.5 1.5 0 0 0-3 0v5.5L2 14.5v2l8.5-2.6V19l-2.5 1.8V22l3.5-1 3.5 1v-1.2L12.5 19v-5.1z';

interface DestinationSliderProps {
  city: string;
  country: string;
  code: string;
  gradient: string;
  /** A simple landmark silhouette, drawn in a 0 0 100 60 viewBox. */
  landmark: React.ReactNode;
  delay?: number;
}

const INTERVAL_MS = 3200;

/**
 * Three auto-crossfading "scenes" per destination card, standing in for
 * real destination photography (not reachable as files — see the
 * marketing-site work notes). All original SVG: a landmark silhouette, a
 * skyline dot pattern, and a "flight to" departure-board scene.
 */
export function DestinationSlider({
  city,
  country,
  code,
  gradient,
  landmark,
  delay = 0,
}: DestinationSliderProps) {
  const [slide, setSlide] = useState(0);

  useEffect(() => {
    const start = setTimeout(() => {
      const id = setInterval(() => setSlide((s) => (s + 1) % 3), INTERVAL_MS);
      return () => clearInterval(id);
    }, delay);
    return () => clearTimeout(start);
  }, [delay]);

  return (
    <motion.div
      whileHover={{ scale: 1.03 }}
      transition={{ duration: 0.25 }}
      className={`relative flex h-40 flex-col justify-end overflow-hidden rounded-2xl bg-gradient-to-br ${gradient} p-5 shadow-md`}
    >
      <AnimatePresence mode="wait">
        {slide === 0 && (
          <motion.svg
            key="landmark"
            viewBox="0 0 100 60"
            preserveAspectRatio="xMidYMax slice"
            className="absolute inset-0 h-full w-full text-white/20"
            fill="currentColor"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
          >
            {landmark}
          </motion.svg>
        )}
        {slide === 1 && (
          <motion.div
            key="skyline"
            className="absolute inset-0 flex items-end justify-center gap-1.5 px-6 pb-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
          >
            {[14, 26, 18, 32, 20, 28, 16].map((h, i) => (
              <span
                key={i}
                className="w-3 rounded-t-sm bg-white/15"
                style={{ height: `${h * 2}px` }}
              />
            ))}
          </motion.div>
        )}
        {slide === 2 && (
          <motion.div
            key="departure"
            className="absolute inset-0 flex items-center justify-center gap-2 text-white/25"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="text-3xl font-bold tracking-widest">{code}</span>
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6 rotate-45">
              <path d={PLANE_PATH} />
            </svg>
          </motion.div>
        )}
      </AnimatePresence>

      <p className="relative text-lg font-semibold text-white">{city}</p>
      <p className="relative text-sm text-white/80">{country}</p>
    </motion.div>
  );
}

'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';

interface Slide {
  title: string;
  body: string;
  gradient: string;
  icon: React.ReactNode;
}

const SLIDES: Slide[] = [
  {
    title: 'All airlines, one booking',
    body: 'Domestic and international flight tickets on Emirates, Qatar Airways, Saudia, Turkish Airlines, Etihad, flydubai, and more — all through one account.',
    gradient: 'from-red-600 to-blue-700',
    icon: (
      <path d="M22 16.5v-2l-8.5-5V4a1.5 1.5 0 0 0-3 0v5.5L2 14.5v2l8.5-2.6V19l-2.5 1.8V22l3.5-1 3.5 1v-1.2L12.5 19v-5.1z" />
    ),
  },
  {
    title: 'Hajj & Umrah, handled end to end',
    body: 'Visa processing, accommodation, and group coordination for pilgrims traveling from Kaduna to Makkah and Madinah.',
    gradient: 'from-blue-700 to-slate-900',
    icon: <path d="M12 2 4 7v2h16V7zM4 11v9h4v-6h8v6h4v-9z" />,
  },
  {
    title: 'Hotels, wherever you land',
    body: 'Domestic and international hotel stays, booked and invoiced the same reliable way as every flight.',
    gradient: 'from-red-700 to-red-900',
    icon: <path d="M7 13c1.66 0 3-1.34 3-3S8.66 7 7 7s-3 1.34-3 3 1.34 3 3 3zm12-6h-8v7H3V5H1v15h2v-3h18v3h2v-9c0-2.21-1.79-4-4-4z" />,
  },
  {
    title: 'Tours & travel insurance',
    body: 'Guided tours and travel insurance arranged directly through the agency, so every trip is covered end to end.',
    gradient: 'from-blue-800 to-red-800',
    icon: (
      <path d="M12 2 3 6v6c0 5.25 3.6 10.16 9 11 5.4-.84 9-5.75 9-11V6l-9-4zm0 9.99h7c-.53 3.94-3.19 7.44-7 8.94V12H5V7.3l7-3.11z" />
    ),
  },
];

const INTERVAL_MS = 4500;

export function ServiceSlider() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % SLIDES.length), INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const slide = SLIDES[index];

  return (
    <div className="relative h-64 overflow-hidden rounded-2xl shadow-xl sm:h-56">
      <AnimatePresence mode="wait">
        <motion.div
          key={slide.title}
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -40 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className={`absolute inset-0 flex flex-col justify-center gap-3 bg-gradient-to-br ${slide.gradient} px-8 py-8 sm:px-12`}
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 text-white backdrop-blur-sm">
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
              {slide.icon}
            </svg>
          </span>
          <h3 className="text-xl font-semibold text-white sm:text-2xl">{slide.title}</h3>
          <p className="max-w-xl text-sm text-white/85 sm:text-base">{slide.body}</p>
        </motion.div>
      </AnimatePresence>

      <div className="absolute bottom-4 left-8 z-10 flex gap-2 sm:left-12">
        {SLIDES.map((s, i) => (
          <button
            key={s.title}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Show slide ${i + 1}: ${s.title}`}
            className={`h-1.5 rounded-full transition-all ${
              i === index ? 'w-6 bg-white' : 'w-1.5 bg-white/40'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

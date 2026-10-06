'use client';

import { motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import { ReactNode, useEffect, useRef } from 'react';

const TONES = {
  amber: 'from-amber-400/25 to-amber-100/0 text-amber-700',
  sky: 'from-sky-400/25 to-sky-100/0 text-sky-700',
  emerald: 'from-emerald-400/25 to-emerald-100/0 text-emerald-700',
  violet: 'from-violet-400/25 to-violet-100/0 text-violet-700',
  rose: 'from-rose-400/25 to-rose-100/0 text-rose-700',
  slate: 'from-slate-400/25 to-slate-100/0 text-slate-700',
} as const;

export type StatTone = keyof typeof TONES;

/**
 * Whole numbers count up from 0 whenever the value changes (so they animate
 * when data arrives after the first render); any other text (e.g. a formatted
 * balance) is shown as is. The animation writes straight to the element, so
 * the rendered text is always the real value even if the effect never runs.
 */
function AnimatedValue({ value }: { value: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el || reduce || !/^\d+$/.test(value)) return;
    const target = Number(value);
    if (target === 0) return;
    const duration = Math.min(1200, 400 + target * 20);
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      el.textContent = String(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      el.textContent = value;
    };
  }, [value, reduce]);

  return (
    <p ref={ref} className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">
      {value}
    </p>
  );
}

export function StatCard({
  label,
  value,
  href,
  icon,
  tone = 'slate',
  index = 0,
}: {
  label: string;
  value: string;
  href?: string;
  icon?: ReactNode;
  tone?: StatTone;
  index?: number;
}) {
  const body = (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -4 }}
      className="group relative h-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-lg hover:shadow-slate-900/10"
    >
      <div className={`pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br ${TONES[tone]} blur-xl transition-transform duration-500 group-hover:scale-150`} />
      <div className="relative flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
        {icon && <span className={`text-base ${TONES[tone].split(' ').pop()}`}>{icon}</span>}
      </div>
      <div className="relative">
        <AnimatedValue value={value} />
      </div>
      {href && (
        <span className="relative mt-1 inline-block text-xs font-medium text-slate-400 transition-colors group-hover:text-amber-600">
          View →
        </span>
      )}
    </motion.div>
  );
  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}

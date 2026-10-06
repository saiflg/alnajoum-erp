'use client';

import { motion } from 'framer-motion';
import { ReactNode } from 'react';
import { SceneArt, SceneKind, useParallax } from '@/components/visual/SceneArt';

/**
 * Compact page header for customer-portal pages: an illustrated, softly
 * parallaxing scene behind a title/subtitle, with an optional actions slot.
 */
export function PageHeader({
  title,
  subtitle,
  scene = 'sky',
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  scene?: SceneKind;
  children?: ReactNode;
}) {
  const { ref, parallax, onPointerMove, onPointerLeave } = useParallax();
  return (
    <motion.header
      ref={ref}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="relative isolate mb-6 overflow-hidden rounded-3xl bg-slate-900 shadow-lg shadow-slate-900/10"
    >
      <SceneArt kind={scene} parallax={parallax} />
      <div className="absolute inset-0 bg-gradient-to-r from-slate-950/85 via-slate-950/55 to-slate-950/15" />
      <div className="relative flex flex-wrap items-center justify-between gap-4 px-6 py-7 sm:px-8 sm:py-9">
        <div className="max-w-2xl">
          <h2 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">{title}</h2>
          {subtitle && <p className="mt-1.5 text-sm text-slate-200">{subtitle}</p>}
        </div>
        {children && <div className="relative">{children}</div>}
      </div>
    </motion.header>
  );
}

export function EmptyState({
  icon = '✦',
  title,
  hint,
}: {
  icon?: string;
  title: string;
  hint?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-6 py-12 text-center"
    >
      <motion.p
        aria-hidden
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
        className="text-3xl"
      >
        {icon}
      </motion.p>
      <p className="mt-3 text-sm font-medium text-slate-800">{title}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </motion.div>
  );
}

'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { useId, useState } from 'react';

interface Point {
  key: string;
  value: number;
}

const W = 720;
const H = 240;
const PAD = { top: 16, right: 12, bottom: 28, left: 12 };

/** "2026-10-01" -> "1 Oct"; month buckets -> "Oct 26". */
function labelFor(key: string, granularity: 'day' | 'week' | 'month'): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (granularity === 'month') {
    return date.toLocaleString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  }
  return date.toLocaleString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/**
 * Dependency-free area/line chart. Every bucket in the range is present (quiet
 * periods are real zeros, supplied by the API), so a gap is never hidden. The
 * focused point is announced to screen readers through the live region.
 */
export function TrendChart({
  points,
  granularity,
  format,
  tone = '#0ea5e9',
}: {
  points: Point[];
  granularity: 'day' | 'week' | 'month';
  format: (n: number) => string;
  tone?: string;
}) {
  const reduce = useReducedMotion();
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  if (points.length === 0) {
    return <p className="py-10 text-center text-sm text-slate-500">No data in this period.</p>;
  }

  const max = Math.max(...points.map((p) => p.value), 1);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${PAD.top + innerH} L${x(0).toFixed(1)},${PAD.top + innerH} Z`;

  // At most ~6 evenly spaced x labels.
  const step = Math.max(1, Math.ceil(points.length / 6));
  const active = hover === null ? null : points[hover];
  const total = points.reduce((s, p) => s + p.value, 0);

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.round(((px - PAD.left) / innerW) * (points.length - 1));
    setHover(Math.min(points.length - 1, Math.max(0, idx)));
  }

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full touch-pan-y"
        role="img"
        aria-label={`Trend over ${points.length} ${granularity} periods, total ${format(total)}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={tone} stopOpacity="0.35" />
            <stop offset="100%" stopColor={tone} stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0, 0.5, 1].map((f) => (
          <line key={f} x1={PAD.left} x2={W - PAD.right} y1={PAD.top + innerH * f} y2={PAD.top + innerH * f} className="stroke-slate-200" strokeDasharray={f === 1 ? undefined : '3 4'} />
        ))}

        <motion.path
          d={area}
          fill={`url(#${gradientId})`}
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6 }}
        />
        <motion.path
          d={line}
          fill="none"
          stroke={tone}
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          initial={reduce ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
        />

        {points.map((p, i) =>
          i % step === 0 || i === points.length - 1 ? (
            <text key={p.key} x={x(i)} y={H - 8} textAnchor="middle" className="fill-slate-400 text-[10px]">
              {labelFor(p.key, granularity)}
            </text>
          ) : null,
        )}

        {active && hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} className="stroke-slate-300" />
            <circle cx={x(hover)} cy={y(active.value)} r={5} fill="#fff" stroke={tone} strokeWidth={2.5} />
          </g>
        )}
      </svg>

      {active && hover !== null && (
        <div
          className="pointer-events-none absolute top-1 -translate-x-1/2 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-lg"
          style={{ left: `${Math.min(88, Math.max(12, (x(hover) / W) * 100))}%` }}
        >
          <span className="text-slate-300">{labelFor(active.key, granularity)}</span>
          <span className="ml-2 font-semibold tabular-nums">{format(active.value)}</span>
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {active ? `${labelFor(active.key, granularity)}: ${format(active.value)}` : ''}
      </p>
    </div>
  );
}

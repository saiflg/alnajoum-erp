'use client';

import {
  motion,
  MotionValue,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'framer-motion';
import type { CSSProperties } from 'react';
import { PointerEvent, ReactNode, useId, useRef } from 'react';

/**
 * Original, hand-drawn SVG "photography stand-ins" — no stock images are
 * bundled with this repo, so every scene is vector art built to look good
 * and to MOVE: drifting clouds, twinkling stars, a plane crossing the sky,
 * flickering skyline windows, a turning globe. Each scene reads the shared
 * pointer-parallax values so layers shift at different depths on hover.
 * All motion is skipped when the visitor prefers reduced motion.
 */

export type SceneKind = 'makkah' | 'sky' | 'city' | 'desert' | 'globe';

export const SCENE_META: Record<SceneKind, { title: string; caption: string }> = {
  makkah: { title: 'Hajj & Umrah', caption: 'Guided journeys to the Holy Cities' },
  sky: { title: 'Flights', caption: 'Hundreds of routes, one search' },
  city: { title: 'Hotels', caption: 'Stays chosen for comfort and location' },
  desert: { title: 'Madinah & beyond', caption: 'Transfers, ziyarat and tours' },
  globe: { title: 'Visas', caption: 'Applications handled end to end' },
};

interface Parallax {
  px: MotionValue<number>;
  py: MotionValue<number>;
}

/** Pointer position in -1..1 over an element, eased with a spring. */
export function useParallax() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const px = useSpring(rawX, { stiffness: 90, damping: 18, mass: 0.6 });
  const py = useSpring(rawY, { stiffness: 90, damping: 18, mass: 0.6 });

  function onPointerMove(e: PointerEvent<HTMLElement>) {
    if (reduce || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    rawX.set(((e.clientX - r.left) / r.width) * 2 - 1);
    rawY.set(((e.clientY - r.top) / r.height) * 2 - 1);
  }
  function onPointerLeave() {
    rawX.set(0);
    rawY.set(0);
  }
  return { ref, parallax: { px, py }, onPointerMove, onPointerLeave };
}

function Layer({ depth, p, children }: { depth: number; p: Parallax; children: ReactNode }) {
  const x = useTransform(p.px, [-1, 1], [-depth, depth]);
  const y = useTransform(p.py, [-1, 1], [-depth * 0.6, depth * 0.6]);
  return <motion.g style={{ x, y }}>{children}</motion.g>;
}

function Cloud({ x, y, s = 1, o = 0.85, dur, delay = 0 }: { x: number; y: number; s?: number; o?: number; dur: number; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.g
      initial={{ x: 0 }}
      animate={reduce ? undefined : { x: [0, 60, 0] }}
      transition={{ duration: dur, repeat: Infinity, ease: 'easeInOut', delay }}
    >
      <g transform={`translate(${x} ${y}) scale(${s})`} fill="white" opacity={o}>
        <ellipse cx="0" cy="0" rx="34" ry="11" />
        <ellipse cx="-14" cy="-8" rx="17" ry="12" />
        <ellipse cx="10" cy="-11" rx="20" ry="14" />
      </g>
    </motion.g>
  );
}

function Stars({ count, seed = 1 }: { count: number; seed?: number }) {
  const stars = Array.from({ length: count }, (_, i) => {
    const a = Math.sin((i + 1) * 12.9898 * seed) * 43758.5453;
    const b = Math.sin((i + 1) * 78.233 * seed) * 12345.6789;
    const round = (n: number) => Math.round(n * 10) / 10;
    return { x: round((a - Math.floor(a)) * 400), y: round((b - Math.floor(b)) * 110), r: 0.6 + ((i * 7) % 5) * 0.25, d: 1.8 + (i % 5) * 0.6 };
  });
  return (
    <g fill="white">
      {stars.map((st, i) => (
        <circle
          key={i}
          cx={st.x}
          cy={st.y}
          r={st.r}
          className="sc-twinkle"
          style={{ '--d': `${st.d}s`, '--dl': `${(i % 7) * 0.3}s` } as CSSProperties}
        />
      ))}
    </g>
  );
}

const PLANE =
  'M22 16.5v-2l-8.5-5V4a1.5 1.5 0 0 0-3 0v5.5L2 14.5v2l8.5-2.6V19l-2.5 1.8V22l3.5-1 3.5 1v-1.2L12.5 19v-5.1z';

function Plane({ y, dur, delay = 0, scale = 1.4, color = 'white' }: { y: number; dur: number; delay?: number; scale?: number; color?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.g
      initial={{ x: -40 }}
      animate={reduce ? { x: 150 } : { x: [-40, 440] }}
      transition={{ duration: dur, repeat: Infinity, ease: 'linear', delay, repeatDelay: 1.5 }}
    >
      <g transform={`translate(0 ${y})`}>
        <line x1="-70" y1="12" x2="2" y2="12" stroke={color} strokeOpacity="0.45" strokeWidth="1.6" strokeLinecap="round" />
        <g transform={`translate(0 0) rotate(90 12 12) scale(${scale})`} fill={color}>
          <path d={PLANE} />
        </g>
      </g>
    </motion.g>
  );
}

function Dunes({ p, colors }: { p: Parallax; colors: [string, string, string] }) {
  return (
    <>
      <Layer depth={6} p={p}>
        <path d="M-20 175 C 60 130 140 150 220 160 S 360 140 430 165 L430 260 L-20 260Z" fill={colors[0]} />
      </Layer>
      <Layer depth={12} p={p}>
        <path d="M-20 195 C 50 165 150 190 240 180 S 370 175 430 195 L430 260 L-20 260Z" fill={colors[1]} />
      </Layer>
      <Layer depth={20} p={p}>
        <path d="M-20 222 C 80 200 170 225 260 212 S 380 205 430 225 L430 260 L-20 260Z" fill={colors[2]} />
      </Layer>
    </>
  );
}

function Minaret({ x, h, fill }: { x: number; h: number; fill: string }) {
  return (
    <g fill={fill}>
      <rect x={x - 4} y={190 - h} width="8" height={h} />
      <rect x={x - 7} y={190 - h + 14} width="14" height="4" />
      <path d={`M${x - 5} ${190 - h} Q ${x} ${190 - h - 26} ${x + 5} ${190 - h}Z`} />
      <circle cx={x} cy={190 - h - 24} r="1.6" fill="#fbbf24" />
    </g>
  );
}

function SceneBody({ kind, p, uid }: { kind: SceneKind; p: Parallax; uid: string }) {
  const reduce = useReducedMotion();

  if (kind === 'makkah') {
    return (
      <>
        <defs>
          <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1e1b4b" />
            <stop offset="0.55" stopColor="#7c2d12" />
            <stop offset="1" stopColor="#f59e0b" />
          </linearGradient>
          <radialGradient id={`${uid}-glow`} cx="0.5" cy="0.62" r="0.5">
            <stop offset="0" stopColor="#fbbf24" stopOpacity="0.55" />
            <stop offset="1" stopColor="#fbbf24" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="400" height="240" fill={`url(#${uid}-bg)`} />
        <Layer depth={3} p={p}>
          <Stars count={36} seed={2} />
        </Layer>
        <Layer depth={5} p={p}>
          <g fill="#fde68a">
            <circle cx="326" cy="46" r="15" />
            <circle cx="333" cy="42" r="14" fill="#3b1d12" />
          </g>
        </Layer>
        <rect width="400" height="240" fill={`url(#${uid}-glow)`} />
        <Layer depth={9} p={p}>
          <Minaret x={96} h={92} fill="#2a1408" />
          <Minaret x={304} h={92} fill="#2a1408" />
          <Minaret x={58} h={64} fill="#1c0e05" />
          <Minaret x={342} h={64} fill="#1c0e05" />
        </Layer>
        <Layer depth={14} p={p}>
          <rect x="164" y="120" width="72" height="72" fill="#111" />
          <rect x="164" y="136" width="72" height="7" fill="#d4a017" />
          <rect x="190" y="156" width="20" height="36" fill="#d4a017" opacity="0.85" />
          <rect x="164" y="120" width="72" height="3" fill="#2a2a2a" />
        </Layer>
        <motion.g
          animate={reduce ? undefined : { rotate: 360 }}
          transition={{ duration: 80, repeat: Infinity, ease: 'linear' }}
          style={{ originX: '200px', originY: '200px' }}
        >
          <ellipse cx="200" cy="200" rx="108" ry="14" fill="none" stroke="#fde68a" strokeOpacity="0.35" strokeDasharray="2 5" />
        </motion.g>
        <Layer depth={22} p={p}>
          <path d="M-20 205 C 90 192 200 214 300 200 S 400 196 430 205 L430 260 L-20 260Z" fill="#150a04" />
        </Layer>
      </>
    );
  }

  if (kind === 'sky') {
    return (
      <>
        <defs>
          <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0369a1" />
            <stop offset="0.6" stopColor="#38bdf8" />
            <stop offset="1" stopColor="#e0f2fe" />
          </linearGradient>
        </defs>
        <rect width="400" height="240" fill={`url(#${uid}-bg)`} />
        <Layer depth={4} p={p}>
          <circle cx="86" cy="62" r="26" fill="#fef08a" opacity="0.95" />
          <circle cx="86" cy="62" r="40" fill="#fef9c3" opacity="0.28" />
        </Layer>
        <Layer depth={7} p={p}>
          <Cloud x={70} y={150} s={1.1} o={0.7} dur={16} />
          <Cloud x={300} y={60} s={0.8} o={0.6} dur={20} delay={1} />
        </Layer>
        <Layer depth={14} p={p}>
          <Plane y={84} dur={9} scale={1.6} />
        </Layer>
        <Layer depth={22} p={p}>
          <Cloud x={190} y={196} s={1.7} o={0.95} dur={12} />
          <Cloud x={20} y={222} s={1.5} o={0.95} dur={14} delay={2} />
          <Cloud x={360} y={214} s={1.6} o={0.95} dur={13} delay={1} />
        </Layer>
      </>
    );
  }

  if (kind === 'city') {
    const buildings = [
      { x: 8, w: 36, h: 92 }, { x: 48, w: 28, h: 130 }, { x: 80, w: 42, h: 76 },
      { x: 126, w: 30, h: 150 }, { x: 160, w: 38, h: 104 }, { x: 202, w: 26, h: 168 },
      { x: 232, w: 40, h: 96 }, { x: 276, w: 30, h: 138 }, { x: 310, w: 38, h: 84 }, { x: 352, w: 40, h: 118 },
    ];
    return (
      <>
        <defs>
          <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0b1026" />
            <stop offset="0.7" stopColor="#312e81" />
            <stop offset="1" stopColor="#be185d" />
          </linearGradient>
        </defs>
        <rect width="400" height="240" fill={`url(#${uid}-bg)`} />
        <Layer depth={3} p={p}>
          <Stars count={30} seed={3} />
        </Layer>
        <Layer depth={5} p={p}>
          <circle cx="60" cy="48" r="16" fill="#f1f5f9" />
          <circle cx="66" cy="44" r="14" fill="#312e81" opacity="0.55" />
        </Layer>
        <Layer depth={10} p={p}>
          {buildings.map((b, bi) => (
            <g key={bi}>
              <rect x={b.x} y={240 - b.h} width={b.w} height={b.h} fill="#0f172a" />
              {Array.from({ length: Math.floor(b.h / 14) }).map((_, r) =>
                Array.from({ length: Math.max(1, Math.floor(b.w / 10)) }).map((__, c) => {
                  const lit = (bi * 7 + r * 3 + c * 5) % 3 !== 0;
                  return (
                    <rect
                      key={`${r}-${c}`}
                      x={b.x + 4 + c * 9}
                      y={240 - b.h + 6 + r * 14}
                      width="5"
                      height="7"
                      fill="#fde68a"
                      opacity={lit ? 0.9 : 0.12}
                      className={lit ? 'sc-flicker' : undefined}
                      style={lit ? ({ '--d': `${3 + ((bi + r + c) % 5)}s`, '--dl': `${((bi * r + c) % 9) * 0.4}s` } as CSSProperties) : undefined}
                    />
                  );
                }),
              )}
            </g>
          ))}
        </Layer>
        <Layer depth={18} p={p}>
          <path d="M-20 232 L430 232 L430 260 L-20 260Z" fill="#020617" />
        </Layer>
      </>
    );
  }

  if (kind === 'desert') {
    return (
      <>
        <defs>
          <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fb923c" />
            <stop offset="0.5" stopColor="#fcd34d" />
            <stop offset="1" stopColor="#fef3c7" />
          </linearGradient>
        </defs>
        <rect width="400" height="240" fill={`url(#${uid}-bg)`} />
        <Layer depth={4} p={p}>
          <motion.circle
            cx="270"
            cy="110"
            r="34"
            fill="#fff7ed"
            style={{ originX: '270px', originY: '110px' }}
            animate={reduce ? undefined : { scale: [1, 1.09, 1] }}
            transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
          />
          <circle cx="270" cy="110" r="58" fill="#fff7ed" opacity="0.25" />
        </Layer>
        <Layer depth={7} p={p}>
          <Cloud x={90} y={56} s={0.9} o={0.55} dur={22} />
        </Layer>
        <Dunes p={p} colors={['#f59e0b', '#d97706', '#92400e']} />
        <Layer depth={18} p={p}>
          {[
            { x: 60, h: 46 },
            { x: 336, h: 56 },
          ].map((t, i) => (
            <g key={i} fill="#3f2305">
              <rect x={t.x - 1.5} y={196 - t.h} width="3" height={t.h} />
              {[-50, -20, 20, 50].map((a) => (
                <path key={a} d={`M${t.x} ${196 - t.h} q ${a * 0.5} -14 ${a * 0.9} ${a > 0 ? 10 : 10}`} stroke="#3f2305" strokeWidth="3" fill="none" strokeLinecap="round" />
              ))}
            </g>
          ))}
        </Layer>
      </>
    );
  }

  // globe — visas
  return (
    <>
      <defs>
        <radialGradient id={`${uid}-bg`} cx="0.5" cy="0.4" r="0.9">
          <stop offset="0" stopColor="#115e59" />
          <stop offset="1" stopColor="#042f2e" />
        </radialGradient>
        <radialGradient id={`${uid}-ball`} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#5eead4" />
          <stop offset="1" stopColor="#0f766e" />
        </radialGradient>
      </defs>
      <rect width="400" height="240" fill={`url(#${uid}-bg)`} />
      <Layer depth={3} p={p}>
        <Stars count={26} seed={5} />
      </Layer>
      <Layer depth={10} p={p}>
        <circle cx="200" cy="120" r="78" fill={`url(#${uid}-ball)`} />
        <g fill="none" stroke="#ccfbf1" strokeOpacity="0.55" strokeWidth="1.2">
          <ellipse cx="200" cy="120" rx="78" ry="26" />
          <ellipse cx="200" cy="120" rx="78" ry="52" />
          <line x1="122" y1="120" x2="278" y2="120" />
          {[0, 1, 2].map((i) => (
            <motion.ellipse
              key={i}
              cx="200"
              cy="120"
              rx="78"
              ry="78"
              style={{ originX: '200px', originY: '120px' }}
              animate={reduce ? { scaleX: 0.5 } : { scaleX: [0.05, 1, 0.05] }}
              transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut', delay: i * 3 }}
            />
          ))}
        </g>
        <motion.g
          animate={reduce ? undefined : { rotate: 360 }}
          transition={{ duration: 18, repeat: Infinity, ease: 'linear' }}
          style={{ originX: '200px', originY: '120px' }}
        >
          <circle cx="200" cy="30" r="5" fill="#fbbf24" />
          <path d={PLANE} transform="translate(188 14) scale(0.9)" fill="#fbbf24" />
        </motion.g>
      </Layer>
      <Layer depth={18} p={p}>
        <g transform="translate(300 170) rotate(-12)">
          <rect width="62" height="46" rx="4" fill="#fef3c7" opacity="0.95" />
          <circle cx="31" cy="23" r="12" fill="none" stroke="#b45309" strokeWidth="2" />
          <path d="M24 23 l5 5 l9 -11" fill="none" stroke="#b45309" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </Layer>
    </>
  );
}

/** One illustrated scene that fills its (relatively positioned) container. */
export function SceneArt({ kind, parallax, className = '' }: { kind: SceneKind; parallax: Parallax; className?: string }) {
  const uid = useId().replace(/:/g, '');
  return (
    <svg
      viewBox="0 0 400 240"
      preserveAspectRatio="xMidYMid slice"
      className={`absolute inset-0 h-full w-full ${className}`}
      aria-hidden
    >
      <SceneBody kind={kind} p={parallax} uid={uid} />
    </svg>
  );
}

'use client';

import { AnimatePresence, motion, useReducedMotion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { PointerEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { SCENE_META, SceneArt, SceneKind, useParallax } from './SceneArt';

const SCENE_ORDER: SceneKind[] = ['makkah', 'sky', 'city', 'desert', 'globe'];

/**
 * Full-bleed auto-advancing slideshow: crossfade + slow Ken Burns zoom/pan,
 * pointer parallax inside each scene, caption chip, progress dots. Pauses
 * while hovered or when the tab is hidden; a single static scene when the
 * visitor prefers reduced motion.
 */
export function SceneSlideshow({
  scenes = SCENE_ORDER,
  intervalMs = 5200,
  className = '',
  showCaption = true,
  overlay = true,
}: {
  scenes?: SceneKind[];
  intervalMs?: number;
  className?: string;
  showCaption?: boolean;
  overlay?: boolean;
}) {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const { ref, parallax, onPointerMove, onPointerLeave } = useParallax();

  useEffect(() => {
    if (reduce || paused || scenes.length < 2) return;
    const id = setInterval(() => {
      if (!document.hidden) setIndex((i) => (i + 1) % scenes.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [reduce, paused, scenes.length, intervalMs]);

  const kind = scenes[index];
  const meta = SCENE_META[kind];

  return (
    <div
      ref={ref}
      onPointerMove={onPointerMove}
      onPointerLeave={() => {
        onPointerLeave();
        setPaused(false);
      }}
      onPointerEnter={() => setPaused(true)}
      className={`absolute inset-0 overflow-hidden ${className}`}
    >
      <AnimatePresence mode="sync">
        <motion.div
          key={kind}
          className="absolute inset-0"
          initial={{ opacity: 0, scale: 1.0 }}
          animate={{ opacity: 1, scale: reduce ? 1 : 1.12 }}
          exit={{ opacity: 0 }}
          transition={{ opacity: { duration: 1.1 }, scale: { duration: (intervalMs + 1200) / 1000, ease: 'linear' } }}
        >
          <SceneArt kind={kind} parallax={parallax} />
        </motion.div>
      </AnimatePresence>

      {overlay && <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/70 via-slate-950/25 to-slate-950/50" />}

      {showCaption && (
        <div className="pointer-events-none absolute bottom-4 left-4 right-4 flex items-end justify-between gap-4">
          <AnimatePresence mode="wait">
            <motion.div
              key={kind}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.45 }}
              className="rounded-xl bg-black/35 px-3 py-2 backdrop-blur"
            >
              <p className="text-sm font-semibold text-white">{meta.title}</p>
              <p className="text-xs text-white/75">{meta.caption}</p>
            </motion.div>
          </AnimatePresence>
          <div className="pointer-events-auto flex gap-1.5">
            {scenes.map((s, i) => (
              <button
                key={s}
                type="button"
                aria-label={`Show ${SCENE_META[s].title}`}
                onClick={() => setIndex(i)}
                className="relative h-1.5 w-6 overflow-hidden rounded-full bg-white/30"
              >
                {i === index && !reduce && (
                  <motion.span
                    key={`${index}-${paused}`}
                    className="absolute inset-y-0 left-0 bg-white"
                    initial={{ width: paused ? '100%' : '0%' }}
                    animate={{ width: '100%' }}
                    transition={{ duration: paused ? 0 : intervalMs / 1000, ease: 'linear' }}
                  />
                )}
                {i === index && reduce && <span className="absolute inset-0 bg-white" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A card whose scene drifts, zooms and parallaxes on hover, with a caption
 * that slides up. Used in the moving gallery and anywhere a "picture" tile
 * is wanted.
 */
export function SceneCard({
  kind,
  title,
  caption,
  className = '',
  children,
}: {
  kind: SceneKind;
  title?: string;
  caption?: string;
  className?: string;
  children?: ReactNode;
}) {
  const { ref, parallax, onPointerMove, onPointerLeave } = useParallax();
  const meta = SCENE_META[kind];
  return (
    <motion.div
      ref={ref}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      whileHover="hover"
      initial="rest"
      animate="rest"
      className={`group relative isolate overflow-hidden rounded-2xl shadow-lg ${className}`}
    >
      <motion.div
        className="absolute inset-0"
        variants={{ rest: { scale: 1 }, hover: { scale: 1.1 } }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      >
        <SceneArt kind={kind} parallax={parallax} />
      </motion.div>
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-950/10 to-transparent" />
      <motion.div
        className="absolute inset-x-0 bottom-0 p-4"
        variants={{ rest: { y: 8 }, hover: { y: 0 } }}
        transition={{ duration: 0.35 }}
      >
        <p className="text-base font-semibold text-white">{title ?? meta.title}</p>
        <motion.p
          className="text-xs text-white/80"
          variants={{ rest: { opacity: 0.6 }, hover: { opacity: 1 } }}
        >
          {caption ?? meta.caption}
        </motion.p>
        {children}
      </motion.div>
    </motion.div>
  );
}

/** 3D tilt toward the pointer with a moving light sheen — for content cards. */
export function TiltCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const sx = useSpring(rx, { stiffness: 160, damping: 16 });
  const sy = useSpring(ry, { stiffness: 160, damping: 16 });
  const mx = useMotionValue(50);
  const my = useMotionValue(50);
  const sheen = useTransform([mx, my], ([x, y]) => `radial-gradient(260px circle at ${x}% ${y}%, rgba(251,191,36,0.20), transparent 60%)`);

  function move(e: PointerEvent<HTMLDivElement>) {
    if (reduce || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    ry.set((x - 0.5) * 10);
    rx.set((0.5 - y) * 10);
    mx.set(x * 100);
    my.set(y * 100);
  }
  function leave() {
    rx.set(0);
    ry.set(0);
  }

  return (
    <motion.div
      ref={ref}
      onPointerMove={move}
      onPointerLeave={leave}
      style={{ rotateX: sx, rotateY: sy, transformPerspective: 900 }}
      whileHover={reduce ? undefined : { y: -4 }}
      className={`relative h-full ${className}`}
    >
      {children}
      <motion.div aria-hidden style={{ background: sheen }} className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300 [div:hover>&]:opacity-100" />
    </motion.div>
  );
}

/** Auto-scrolling strip of scene cards that slows and zooms on hover. */
export function SceneGallery({ items }: { items: Array<{ kind: SceneKind; title: string; caption: string }> }) {
  return (
    <div className="group/gallery overflow-hidden py-2">
      <div className="flex w-max animate-marquee gap-5 group-hover/gallery:[animation-play-state:paused]" style={{ animationDuration: '60s' }}>
        {[...items, ...items].map((item, i) => (
          <SceneCard key={i} kind={item.kind} title={item.title} caption={item.caption} className="h-56 w-72 shrink-0 sm:h-64 sm:w-80" />
        ))}
      </div>
    </div>
  );
}

/** Header band for inner pages: animated scene behind a title. */
export function PageBanner({
  eyebrow,
  title,
  subtitle,
  kind = 'sky',
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  kind?: SceneKind;
}) {
  const { ref, parallax, onPointerMove, onPointerLeave } = useParallax();
  return (
    <section
      ref={ref}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      className="relative isolate overflow-hidden bg-slate-900"
    >
      <SceneArt kind={kind} parallax={parallax} />
      <div className="absolute inset-0 bg-gradient-to-r from-slate-950/85 via-slate-950/50 to-slate-950/20" />
      <div className="relative mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
        {eyebrow && (
          <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-400">
            {eyebrow}
          </motion.p>
        )}
        <motion.h1
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
          className="mt-2 max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-5xl"
        >
          {title}
        </motion.h1>
        {subtitle && (
          <motion.p initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.15 }} className="mt-4 max-w-xl text-base text-slate-200">
            {subtitle}
          </motion.p>
        )}
      </div>
    </section>
  );
}

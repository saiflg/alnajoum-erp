import { ReactNode } from 'react';

/**
 * Infinite horizontal scroller. Renders `items` twice back-to-back and
 * scrolls the track exactly -50% via the `animate-marquee` keyframe in
 * globals.css, so the seam between the two copies is never visible.
 */
export function Marquee({ items }: { items: ReactNode[] }) {
  return (
    <div className="overflow-hidden">
      <div className="flex w-max animate-marquee items-center">
        {[...items, ...items].map((item, i) => (
          <div key={i} className="flex shrink-0 items-center px-8">
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Colour helpers for the identification card. The card's look follows the two colours a company chooses, so shades are
 * derived from them and never fixed. These mirror the helpers the API uses to draw the PDF so the screen and the paper
 * match.
 */
export const rgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0) as [number, number, number];
};

const toHex = (c: number[]): string =>
  '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

/** Blends `a` towards `b` by `t` (0 = a, 1 = b). */
export const mix = (a: string, b: string, t: number): string => {
  const x = rgb(a);
  const y = rgb(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
};

export const luminance = (hex: string): number => {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Readable text colour on top of a background colour. */
export const onColor = (bg: string): string => (luminance(bg) > 0.4 ? '#0f172a' : '#ffffff');

/** The company colour as ink on white: darkened when it is too pale to read. */
export const inkOnWhite = (hex: string): string => (luminance(hex) > 0.35 ? mix(hex, '#000000', 0.6) : hex);

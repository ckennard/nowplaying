export type RGB = [number, number, number];
export interface Palette { colors: RGB[]; accent: RGB; base: RGB }

export const DEFAULT_PALETTE: Palette = {
  colors: [[255, 122, 89], [192, 75, 255], [63, 208, 255], [40, 30, 90]],
  accent: [255, 122, 89],
  base: [11, 11, 16],
};

function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): RGB {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

const dist = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const cache = new Map<string, Palette>();

/** Extracts a 4-color palette from an image URL (same-origin). Favors colorful, common colors. */
export async function extractPalette(url: string): Promise<Palette> {
  const hit = cache.get(url);
  if (hit) return hit;
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  const size = 48;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += r; e.g += g; e.b += b;
    buckets.set(key, e);
  }
  const cands = [...buckets.values()].map((e) => {
    const rgb: RGB = [e.r / e.n, e.g / e.n, e.b / e.n].map(Math.round) as RGB;
    const [, s, l] = rgbToHsl(rgb);
    const score = e.n * (0.25 + s) * (1 - Math.abs(l - 0.5) * 1.2);
    return { rgb, score, n: e.n, s, l };
  }).sort((a, b) => b.score - a.score);

  const picked: RGB[] = [];
  for (const cnd of cands) {
    if (picked.every((p) => dist(p, cnd.rgb) > 70)) picked.push(cnd.rgb);
    if (picked.length === 4) break;
  }
  while (picked.length < 4) picked.push(picked[picked.length - 1] ?? DEFAULT_PALETTE.colors[picked.length]);

  // Normalize for display on a dark screen: lift very dark colors, tame neon ones.
  const colors = picked.map((rgb) => {
    const [h, s, l] = rgbToHsl(rgb);
    return hslToRgb(h, Math.min(0.85, s * 1.1), Math.max(0.28, Math.min(0.62, l)));
  });
  const vivid = [...picked].sort((a, b) => rgbToHsl(b)[1] - rgbToHsl(a)[1])[0];
  const [ah, as] = rgbToHsl(vivid);
  const accent = hslToRgb(ah, Math.max(0.55, as), 0.62);
  const [bh, bs] = rgbToHsl(picked[0]);
  const base = hslToRgb(bh, Math.min(0.5, bs), 0.06);
  const p = { colors, accent, base };
  if (cache.size > 100) cache.clear();
  cache.set(url, p);
  return p;
}

export const css = (c: RGB, a = 1) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;

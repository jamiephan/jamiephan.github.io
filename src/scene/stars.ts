/**
 * Procedural starfield: positions, colours and sizes for a `Points` cloud.
 *
 * Kept free of three.js so it can be unit-tested and reasoned about on its own.
 */

/** Small, fast, seedable PRNG so the sky looks the same on every visit. */
export const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * Approximate sRGB-ish colour of a black body at `kelvin`, normalised so the brightest
 * channel is 1. (Tanner Helland's fit, good to a few percent over 1,000–40,000 K.)
 */
export const blackbodyColor = (kelvin: number): [number, number, number] => {
  const t = kelvin / 100;
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const g =
    t <= 66
      ? 99.4708025861 * Math.log(t) - 161.1195681661
      : 288.1221695283 * (t - 60) ** -0.0755148492;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;

  const channels = [r, g, b].map((c) => Math.min(255, Math.max(0, c)) / 255);
  const max = Math.max(...channels);
  return [channels[0]! / max, channels[1]! / max, channels[2]! / max];
};

/**
 * Sample an apparent magnitude in [min, max] where faint stars are much more common than
 * bright ones (the number of stars grows roughly ×2.5 per magnitude).
 */
export const sampleMagnitude = (u: number, min: number, max: number, growth = 0.4): number => {
  const lo = 10 ** (growth * min);
  const hi = 10 ** (growth * max);
  return Math.log10(lo + u * (hi - lo)) / growth;
};

/** Spectral classes with a rough share of naked-eye stars and a representative temperature. */
const SPECTRAL_CLASSES = [
  { share: 0.1, kelvin: 3200 }, // M
  { share: 0.25, kelvin: 4400 }, // K
  { share: 0.22, kelvin: 5700 }, // G
  { share: 0.18, kelvin: 6700 }, // F
  { share: 0.17, kelvin: 8800 }, // A
  { share: 0.08, kelvin: 16000 }, // B
] as const;

const sampleTemperature = (u: number, jitter: number): number => {
  let acc = 0;
  for (const { share, kelvin } of SPECTRAL_CLASSES) {
    acc += share;
    if (u <= acc) return kelvin * (0.9 + jitter * 0.2);
  }
  return 6000;
};

export interface StarfieldOptions {
  count: number;
  radius: number;
  seed?: number;
  /** Brightest and faintest apparent magnitude. */
  magnitudeRange?: [number, number];
  /** Fraction of stars concentrated around the galactic plane (local XZ plane). */
  galacticFraction?: number;
}

export interface Starfield {
  positions: Float32Array;
  /** Linear RGB, already scaled by brightness (values may exceed 1 for HDR). */
  colors: Float32Array;
  /** Point size in CSS pixels. */
  sizes: Float32Array;
}

export const generateStarfield = ({
  count,
  radius,
  seed = 1337,
  magnitudeRange: [brightest, faintest] = [-1.2, 6.5],
  galacticFraction = 0.45,
}: StarfieldOptions): Starfield => {
  const random = mulberry32(seed);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    // Direction: uniform on the sphere, or clustered around the galactic plane.
    const longitude = random() * Math.PI * 2;
    let latitude: number;
    if (random() < galacticFraction) {
      // Box–Muller gaussian, ~12° spread.
      const gaussian =
        Math.sqrt(-2 * Math.log(Math.max(random(), 1e-9))) * Math.cos(2 * Math.PI * random());
      latitude = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, gaussian * 0.21));
    } else {
      latitude = Math.asin(random() * 2 - 1);
    }
    const cosLat = Math.cos(latitude);
    positions[i * 3] = radius * cosLat * Math.cos(longitude);
    positions[i * 3 + 1] = radius * Math.sin(latitude);
    positions[i * 3 + 2] = radius * cosLat * Math.sin(longitude);

    // Brightness relative to the faintest star (Pogson's ratio: 2.512× per magnitude).
    const magnitude = sampleMagnitude(random(), brightest, faintest);
    const flux = 10 ** (-0.4 * (magnitude - faintest));
    const intensity = 0.16 * flux ** 0.4;
    sizes[i] = 1.2 + 0.6 * Math.log10(flux);

    // Colour: black-body tint, desaturated a little as the eye sees faint stars as white.
    const [r, g, b] = blackbodyColor(sampleTemperature(random(), random()));
    const saturation = 0.55 + 0.35 * Math.min(1, Math.log10(flux) / 2);
    colors[i * 3] = (1 + (r - 1) * saturation) * intensity;
    colors[i * 3 + 1] = (1 + (g - 1) * saturation) * intensity;
    colors[i * 3 + 2] = (1 + (b - 1) * saturation) * intensity;
  }

  return { positions, colors, sizes };
};

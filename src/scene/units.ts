/**
 * Real-world units for the scene, taking the Earth's size as the ruler: its radius is
 * 4 world units, so one unit is a quarter of 6,371 km. (Distances between bodies are
 * compressed, but sizes, and so speeds relative to them, are to scale.)
 *
 * Free of three.js so the UI can use it without loading the 3D chunk.
 */

export const EARTH_RADIUS_KM = 6371;
export const KM_PER_UNIT = EARTH_RADIUS_KM / 4;
export const LIGHT_SPEED_KM_S = 299_792.458;

export interface Speed {
  kmPerSecond: number;
  /** Light-seconds per second, i.e. the fraction of the speed of light. */
  lightSecondsPerSecond: number;
}

export const toRealSpeed = (unitsPerSecond: number): Speed => {
  const kmPerSecond = unitsPerSecond * KM_PER_UNIT;
  return {
    kmPerSecond,
    lightSecondsPerSecond: kmPerSecond / LIGHT_SPEED_KM_S,
  };
};

const SUPERSCRIPT: Record<string, string> = {
  "-": "⁻",
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
};

/**
 * A tiny number in readable scientific notation, e.g. 1.23 × 10⁻⁵. Exactly zero is "0".
 */
export const formatScientific = (value: number, digits = 3): string => {
  if (value === 0 || !Number.isFinite(value)) return "0";
  const [mantissa, exponent] = value.toExponential(digits - 1).split("e") as [string, string];
  const power = Number(exponent);
  if (power === 0) return mantissa;
  const superscript = String(power)
    .split("")
    .map((c) => SUPERSCRIPT[c] ?? c)
    .join("");
  return `${mantissa} × 10${superscript}`;
};

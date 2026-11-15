export const degToRad = (deg: number): number => deg * (Math.PI / 180);

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * How far the page has been scrolled, as a 0–1 fraction of the scrollable range.
 * Returns 0 when the page doesn't scroll.
 */
export const scrollProgress = (
  scrollTop: number,
  scrollHeight: number,
  viewportHeight: number,
): number => {
  const scrollable = scrollHeight - viewportHeight;
  return scrollable > 0 ? clamp(scrollTop / scrollable, 0, 1) : 0;
};

/** Linear interpolation between `from` and `to`. */
export const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

/**
 * Convert a per-frame amount authored at 60 fps into a frame-rate independent amount
 * for an elapsed `deltaSeconds`, so animation speed is identical on 60/120/144 Hz displays.
 */
export const perFrameAt60 = (amountPerFrame: number, deltaSeconds: number): number =>
  amountPerFrame * deltaSeconds * 60;

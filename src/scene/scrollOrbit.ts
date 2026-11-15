/**
 * How far the camera swings round the Earth by the bottom of the page.
 *
 * The camera orbits about the vertical axis (azimuth), then tilts up (elevation), always looking
 * at the Earth. It turns towards the Sun, so by the end the Earth is a backlit crescent with its
 * city lights showing, and the Sun sits in an upper corner of the screen:
 *
 * - Landscape (desktop, phones on their side): top right. The Sun, which starts behind the
 *   camera on the right, comes in from the right-hand edge.
 * - Portrait: top left, clear of the thumbs. The camera swings the other way, so the Sun passes
 *   behind it and comes in from the left-hand edge.
 */
import { Vector3 } from "three";

import { SUN_DIRECTION } from "./layout.ts";

/** Where the Sun ends up, in normalised device coordinates (-1 to 1, +y up). */
export const SUN_ON_SCREEN = {
  landscape: { x: 0.82, y: 0.68 },
  portrait: { x: -0.45, y: 0.6 },
} as const;

export interface ScrollOrbit {
  /** Radians about the vertical (+Z) axis; positive turns the view to the left. */
  azimuth: number;
  /** Radians the camera rises above its starting height. */
  elevation: number;
}

const TAU = Math.PI * 2;
const direction = new Vector3();

/**
 * The swing that puts the Sun at `SUN_ON_SCREEN` for a camera with this aspect ratio and
 * vertical field of view (degrees), starting from the default view (looking along +Y, +Z up).
 */
export const scrollOrbitFor = (aspect: number, fov: number): ScrollOrbit => {
  const portrait = aspect < 1;
  const target = portrait ? SUN_ON_SCREEN.portrait : SUN_ON_SCREEN.landscape;
  const tan = Math.tan((fov * Math.PI) / 360);
  // The Sun's direction in the camera's frame at the end (x right, y forward, z up).
  const d = direction.set(target.x * tan * aspect, 1, target.y * tan).normalize();
  const sun = SUN_DIRECTION;

  // Tilting about the camera's x axis by -elevation has to bring the Sun to its real height…
  const reach = Math.hypot(d.y, d.z);
  const tilt = Math.asin(Math.min(1, Math.max(-1, sun.z / reach))) - Math.atan2(d.z, d.y);
  const forward = d.y * Math.cos(tilt) - d.z * Math.sin(tilt);
  // …then turning about the vertical brings it round to the right bearing.
  let azimuth = Math.atan2(sun.y, sun.x) - Math.atan2(forward, d.x);
  // Landscape turns right (negative); portrait turns left, the long way round behind the camera.
  azimuth = ((azimuth % TAU) + TAU) % TAU;
  if (!portrait) azimuth -= TAU;
  return { azimuth, elevation: -tilt };
};

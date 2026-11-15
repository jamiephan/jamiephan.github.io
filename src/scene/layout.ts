/**
 * Where the planets and the asteroid belt sit, relative to the Earth (the origin) and the Sun.
 *
 * The Sun is lit and drawn as if infinitely far away along `SUN_DIRECTION` (parallel light), so
 * "distance from the Sun" here is depth along that axis: `sunDistance` says how much further
 * from the Sun than the Earth a point is. The planets keep their real order by that measure
 * (Mercury, Venus, Earth, Mars, the belt, Jupiter, Saturn, Uranus, Neptune), and all lie close
 * to one ecliptic plane, which passes through the lower part of the default view.
 *
 * Distances are heavily compressed (the giants are one to two thousand units out, a few
 * seconds' flight at full speed) and the positions are chosen so Mars, Jupiter and Saturn
 * frame the Earth in the default view, with the rest out of shot.
 */
import { Vector3 } from "three";

import type { BodyId } from "./bodies.ts";

/** Direction towards the Sun: off-screen to the right so the Earth shows a bright gibbous face. */
export const SUN_DIRECTION = new Vector3(1, -0.35, 0.25).normalize();

/**
 * Normal to the ecliptic (the plane the planets orbit in). It contains the Sun's direction and
 * crosses the default view below the Earth, where the asteroid belt runs.
 */
export const ECLIPTIC_NORMAL = new Vector3(-0.0969, 0.3801, 0.9199)
  .projectOnPlane(SUN_DIRECTION)
  .normalize();

/** How much further from the Sun than the Earth `point` is (negative = closer). */
export const sunDistance = (point: Vector3): number => -point.dot(SUN_DIRECTION);

/** World units per Earth radius. One scale for every planet, so their sizes compare truly. */
export const EARTH_RADIUS = 4;

export type PlanetId = Exclude<BodyId, "earth" | "moon" | "comet">;

/** Where each planet sits (world units, Earth at the origin). */
export const PLANET_POSITIONS: Readonly<Record<PlanetId, Vector3>> = {
  // Inner planets: sunwards, and (like the real ones) never far from the Sun in the sky, so they
  // only show up when you look towards it.
  mercury: new Vector3(138, -120, 68),
  venus: new Vector3(63, -102, 45),
  // Outer planets: further from the Sun in order, and further from the Earth too.
  mars: new Vector3(63, 201, -52),
  jupiter: new Vector3(198, 806, -283),
  saturn: new Vector3(-246, 1102, -481),
  uranus: new Vector3(-1484, -218, -23),
  neptune: new Vector3(-1542, 1062, -547),
};

/**
 * The asteroid belt: a band in the ecliptic between Mars and Jupiter. The Sun is so far away
 * that the belt's curve round it is imperceptible here, so it runs straight. It spans
 * `sunDistance` `inner`–`outer`, `length` units along the band and `thickness` either side of
 * the ecliptic.
 */
export const BELT_LAYOUT = {
  inner: 60,
  outer: 110,
  length: 4000,
  thickness: 6,
} as const;

/** A planet's spin axis: the ecliptic normal tipped over by `obliquity` degrees. */
export const spinAxis = (obliquity: number, azimuth: number): Vector3 => {
  const along = new Vector3().crossVectors(ECLIPTIC_NORMAL, SUN_DIRECTION).normalize();
  return ECLIPTIC_NORMAL.clone()
    .applyAxisAngle(along, (obliquity * Math.PI) / 180)
    .applyAxisAngle(ECLIPTIC_NORMAL, (azimuth * Math.PI) / 180);
};

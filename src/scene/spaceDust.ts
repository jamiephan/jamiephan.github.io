/**
 * Interplanetary dust drifting between the camera and everything else: faint motes in a box
 * that wraps around the camera (see `createSpaceDustMaterial`), and the same grains again as
 * streaks that fade in at speed.
 */
import { BufferAttribute, BufferGeometry, LineSegments, Points, Vector3, Vector4 } from "three";

import { EARTH_RADIUS } from "./layout.ts";
import {
  createDustStreakMaterial,
  createSpaceDustMaterial,
  type LightingUniforms,
  type SpaceDustUniforms,
} from "./materials.ts";
import { mulberry32 } from "./stars.ts";

/** Dust motes in a box of this size (world units) that wraps around the camera. */
const DUST_COUNT = 1350;
const DUST = {
  boxSize: 44,
  /** Grain diameter in world units (exaggerated: real grains are microscopic). */
  size: 0.0175,
  intensity: 0.25,
  /** Slow drift through the solar wind, units per second. */
  drift: new Vector3(0.12, 0.05, -0.03),
  /** Streaks span this many seconds of travel, and fade in between these speeds. */
  streakTime: 0.06,
  streakSpeeds: [15, 60] as [number, number],
  /** Between these speeds, three quarters of the streaks fade out so fast flight stays readable. */
  streakThinSpeeds: [60, 240] as [number, number],
};

export interface SpaceDust {
  dots: Points;
  streaks: LineSegments;
  /** Set each frame: camera position and velocity, time; and the point scale on resize. */
  uniforms: SpaceDustUniforms;
}

export const createSpaceDust = (lighting: LightingUniforms): SpaceDust => {
  const uniforms: SpaceDustUniforms = {
    uCameraPos: { value: new Vector3() },
    uVelocity: { value: new Vector3() },
    uTime: { value: 0 },
    uPointScale: { value: 1 },
  };
  const random = mulberry32(2718);
  const positions = new Float32Array(DUST_COUNT * 3);
  const randoms = new Float32Array(DUST_COUNT * 2);
  for (let i = 0; i < positions.length; i++) positions[i] = random();
  for (let i = 0; i < randoms.length; i++) randoms[i] = random();
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("aRandom", new BufferAttribute(randoms, 2));

  // The Earth's shadow darkens the grains.
  const earth = { value: new Vector4(0, 0, 0, EARTH_RADIUS) };
  const dots = new Points(geometry, createSpaceDustMaterial(uniforms, lighting, DUST, earth));
  // Positions are wrapped around the camera in the shader, so the bounds mean nothing.
  dots.frustumCulled = false;

  // The same grains again as head/tail pairs, for streaks at speed.
  const pairs = new Float32Array(DUST_COUNT * 6);
  const pairRandoms = new Float32Array(DUST_COUNT * 4);
  const ends = new Float32Array(DUST_COUNT * 2);
  for (let i = 0; i < DUST_COUNT; i++) {
    for (const end of [0, 1]) {
      const v = i * 2 + end;
      pairs.set(positions.subarray(i * 3, i * 3 + 3), v * 3);
      pairRandoms.set(randoms.subarray(i * 2, i * 2 + 2), v * 2);
      ends[v] = end;
    }
  }
  const streakGeometry = new BufferGeometry();
  streakGeometry.setAttribute("position", new BufferAttribute(pairs, 3));
  streakGeometry.setAttribute("aRandom", new BufferAttribute(pairRandoms, 2));
  streakGeometry.setAttribute("aEnd", new BufferAttribute(ends, 1));
  const streaks = new LineSegments(
    streakGeometry,
    createDustStreakMaterial(uniforms, lighting, DUST, earth),
  );
  streaks.frustumCulled = false;
  return { dots, streaks, uniforms };
};

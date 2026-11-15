import { Vector3 } from "three";
import { describe, expect, it } from "vite-plus/test";

import { MAX_RANGE } from "./flight.ts";
import {
  BELT_LAYOUT,
  ECLIPTIC_NORMAL,
  PLANET_POSITIONS,
  SUN_DIRECTION,
  sunDistance,
  type PlanetId,
} from "./layout.ts";

const ORDER: PlanetId[] = ["mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune"];
const degrees = (radians: number) => (radians * 180) / Math.PI;

describe("solar system layout", () => {
  it("puts the ecliptic through the Sun", () => {
    expect(Math.abs(ECLIPTIC_NORMAL.dot(SUN_DIRECTION))).toBeLessThan(1e-6);
  });

  it("orders the planets by distance from the Sun, with the belt between Mars and Jupiter", () => {
    const depths = ORDER.map((id) => sunDistance(PLANET_POSITIONS[id]));
    expect(depths).toEqual([...depths].sort((a, b) => a - b));
    // The Earth (depth 0) sits between Venus and Mars.
    expect(sunDistance(PLANET_POSITIONS.venus)).toBeLessThan(0);
    expect(sunDistance(PLANET_POSITIONS.mars)).toBeGreaterThan(0);
    expect(sunDistance(PLANET_POSITIONS.mars)).toBeLessThan(BELT_LAYOUT.inner);
    expect(sunDistance(PLANET_POSITIONS.jupiter)).toBeGreaterThan(BELT_LAYOUT.outer);
  });

  it("puts the outer planets further from the Earth in order, all within flying range", () => {
    const outer = ORDER.slice(2).map((id) => PLANET_POSITIONS[id].length());
    expect(outer).toEqual([...outer].sort((a, b) => a - b));
    expect(Math.max(...outer)).toBeLessThan(MAX_RANGE * 0.8);
  });

  it("keeps the planets close to the ecliptic", () => {
    for (const id of ORDER) {
      const position = PLANET_POSITIONS[id];
      const latitude = degrees(Math.asin(position.dot(ECLIPTIC_NORMAL) / position.length()));
      expect(Math.abs(latitude), id).toBeLessThan(7);
    }
  });

  it("keeps the inner planets near the Sun in the sky, as seen from the Earth", () => {
    const elongation = (id: PlanetId) =>
      degrees(new Vector3().copy(PLANET_POSITIONS[id]).normalize().angleTo(SUN_DIRECTION));
    // Their real greatest elongations.
    expect(elongation("mercury")).toBeLessThan(28);
    expect(elongation("venus")).toBeLessThan(47);
  });
});

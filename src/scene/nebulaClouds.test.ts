import { describe, expect, it } from "vite-plus/test";
import { MAX_RANGE } from "./flight.ts";
import { NEBULA_CLOUDS, generateNebulaPuffs } from "./nebulaClouds.ts";

describe("generateNebulaPuffs", () => {
  it("is deterministic", () => {
    const spec = NEBULA_CLOUDS[0]!;
    expect(generateNebulaPuffs(spec)).toEqual(generateNebulaPuffs(spec));
  });

  it("keeps every puff near its cloud, with positive size and brightness", () => {
    for (const spec of NEBULA_CLOUDS) {
      const { shapes, colors, motion } = generateNebulaPuffs(spec);
      expect(shapes.length).toBe(spec.puffs * 4);
      for (let i = 0; i < spec.puffs; i++) {
        const dx = shapes[i * 4]! - spec.centre[0];
        const dy = shapes[i * 4 + 1]! - spec.centre[1];
        const dz = shapes[i * 4 + 2]! - spec.centre[2];
        expect(Math.hypot(dx, dy, dz)).toBeLessThan(spec.size * 3);
        expect(shapes[i * 4 + 3]).toBeGreaterThan(0);
        expect(colors[i * 3]! + colors[i * 3 + 1]! + colors[i * 3 + 2]!).toBeGreaterThan(0);
        expect([0, 1, 2, 3]).toContain(motion[i * 4 + 2]);
      }
    }
  });

  it("stays within flight range of the Earth", () => {
    for (const { centre, size } of NEBULA_CLOUDS) {
      expect(Math.hypot(...centre) + size).toBeLessThan(MAX_RANGE);
    }
  });

  it("keeps every puff's haze clear of the Earth, so the page itself isn't fogged", () => {
    for (const spec of NEBULA_CLOUDS) {
      const { shapes } = generateNebulaPuffs(spec);
      for (let i = 0; i < spec.puffs; i++) {
        const [x, y, z, radius] = shapes.subarray(i * 4, i * 4 + 4);
        expect(Math.hypot(x!, y!, z!) - radius!).toBeGreaterThan(100);
      }
    }
  });
});

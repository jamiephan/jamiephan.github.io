import { describe, expect, it } from "vite-plus/test";
import { GALAXIES } from "./galaxies.ts";

const angleBetween = (a: readonly number[], b: readonly number[]): number => {
  const dot = a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  return (Math.acos(Math.min(1, dot / (Math.hypot(...a) * Math.hypot(...b)))) * 180) / Math.PI;
};

describe("GALAXIES", () => {
  it("don't overlap on the sky (apart from companions placed at an arm's tip)", () => {
    for (const [i, a] of GALAXIES.entries()) {
      for (const b of GALAXIES.slice(i + 1)) {
        // A companion is small and touches its host's rim; everything else keeps well apart.
        const companion = Math.min(a.size, b.size) < 1.5;
        const gap = angleBetween(a.direction, b.direction) - a.size - b.size;
        expect(gap).toBeGreaterThan(companion ? -1.5 : 5);
      }
    }
  });

  it("have sensible shapes", () => {
    for (const galaxy of GALAXIES) {
      expect(galaxy.inclination).toBeGreaterThanOrEqual(0);
      expect(galaxy.inclination).toBeLessThan(90);
      for (const fraction of [galaxy.ring, galaxy.spheroid, galaxy.flocculent, galaxy.dustLane]) {
        if (fraction !== undefined) expect(fraction).toBeGreaterThan(0);
        if (fraction !== undefined) expect(fraction).toBeLessThanOrEqual(1);
      }
    }
  });

  it("fill the sky overhead and underneath too, not just round the horizon", () => {
    const elevation = ([x, y, z]: readonly number[]) =>
      (Math.asin(z! / Math.hypot(x!, y!, z!)) * 180) / Math.PI;
    expect(GALAXIES.filter((g) => elevation(g.direction) > 55).length).toBeGreaterThanOrEqual(4);
    expect(GALAXIES.filter((g) => elevation(g.direction) < -55).length).toBeGreaterThanOrEqual(4);
  });
});

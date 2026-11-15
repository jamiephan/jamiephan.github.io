import { describe, expect, it } from "vite-plus/test";
import {
  eccentricAnomaly,
  meanAnomalyAt,
  orbitAt,
  periodForHiddenTime,
  visibleFraction,
} from "./orbit.ts";

describe("eccentricAnomaly", () => {
  it("satisfies Kepler's equation", () => {
    for (const e of [0, 0.3, 0.7, 0.95]) {
      for (const m of [-3, -1, 0, 0.5, 2, 3.1]) {
        const E = eccentricAnomaly(m, e);
        expect(E - e * Math.sin(E)).toBeCloseTo(m, 9);
      }
    }
  });
});

describe("orbitAt", () => {
  const a = 300;
  const e = 0.3;

  it("is closest at periapsis and furthest at apoapsis", () => {
    expect(orbitAt(0, a, e).r).toBeCloseTo(a * (1 - e));
    expect(orbitAt(Math.PI, a, e).r).toBeCloseTo(a * (1 + e));
  });

  it("repeats every full orbit", () => {
    const first = orbitAt(1.2, a, e);
    const next = orbitAt(1.2 + 2 * Math.PI, a, e);
    expect(next.x).toBeCloseTo(first.x, 6);
    expect(next.y).toBeCloseTo(first.y, 6);
  });

  it("moves faster near periapsis than near apoapsis", () => {
    const step = 0.01;
    const travelled = (m: number) => {
      const p = orbitAt(m, a, e);
      const q = orbitAt(m + step, a, e);
      return Math.hypot(q.x - p.x, q.y - p.y);
    };
    expect(travelled(0)).toBeGreaterThan(travelled(Math.PI) * 1.5);
  });

  it("heads anticlockwise at periapsis", () => {
    const { vx, vy } = orbitAt(0, a, e);
    expect(vx).toBeCloseTo(0);
    expect(vy).toBeGreaterThan(0);
  });
});

describe("meanAnomalyAt", () => {
  it("is zero at periapsis and π at apoapsis", () => {
    expect(meanAnomalyAt(0, 0.5)).toBeCloseTo(0);
    expect(meanAnomalyAt(Math.PI - 1e-9, 0.5)).toBeCloseTo(Math.PI);
  });

  it("round-trips with orbitAt", () => {
    const e = 0.5;
    const nu = 2.2;
    const { x, y } = orbitAt(meanAnomalyAt(nu, e), 200, e);
    expect(Math.atan2(y, x)).toBeCloseTo(nu, 6);
  });
});

describe("visibleFraction / periodForHiddenTime", () => {
  const a = 200;
  const e = 0.5;
  // Visible on the far half of the orbit (x < 0), which it crosses slowly.
  const farSide = (x: number) => x < 0;

  it("matches the time-weighted share of the orbit", () => {
    // x = r·cos(ν) = 0 at ν = π/2; time from periapsis to there via Kepler's equation.
    const nu = Math.PI / 2;
    const hiddenShare = (2 * meanAnomalyAt(nu, e)) / (2 * Math.PI);
    expect(visibleFraction(farSide, a, e, 20000)).toBeCloseTo(1 - hiddenShare, 3);
  });

  it("spends more than half the time on the far half (Kepler's second law)", () => {
    expect(visibleFraction(farSide, a, e)).toBeGreaterThan(0.75);
  });

  it("gives a period with the requested hidden time", () => {
    const fraction = visibleFraction(farSide, a, e, 20000);
    const period = periodForHiddenTime(20, fraction);
    expect(period * (1 - fraction)).toBeCloseTo(20, 6);
  });
});

import { describe, expect, it } from "vite-plus/test";
import { blackbodyColor, generateStarfield, mulberry32, sampleMagnitude } from "./stars.ts";

describe("mulberry32", () => {
  it("is deterministic and in [0, 1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("blackbodyColor", () => {
  it("is red-tinted for cool stars and blue-tinted for hot stars", () => {
    const [coolR, , coolB] = blackbodyColor(3200);
    const [hotR, , hotB] = blackbodyColor(16000);
    expect(coolR).toBe(1);
    expect(coolB).toBeLessThan(0.6);
    expect(hotB).toBe(1);
    expect(hotR).toBeLessThan(0.9);
  });

  it("is close to white around the Sun's temperature", () => {
    for (const channel of blackbodyColor(6500)) expect(channel).toBeGreaterThan(0.95);
  });
});

describe("sampleMagnitude", () => {
  it("maps 0 and 1 to the range ends", () => {
    expect(sampleMagnitude(0, -1, 6)).toBeCloseTo(-1);
    expect(sampleMagnitude(1, -1, 6)).toBeCloseTo(6);
  });

  it("favours faint stars", () => {
    expect(sampleMagnitude(0.5, -1, 6)).toBeGreaterThan(4.5);
  });
});

describe("generateStarfield", () => {
  const { positions, colors, sizes } = generateStarfield({ count: 500, radius: 10 });

  it("places every star on the sphere", () => {
    for (let i = 0; i < 500; i++) {
      const length = Math.hypot(positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!);
      expect(length).toBeCloseTo(10, 3);
    }
  });

  it("produces positive sizes and colours", () => {
    expect(sizes.every((size) => size >= 1.2)).toBe(true);
    expect(colors.every((channel) => channel > 0)).toBe(true);
  });
});

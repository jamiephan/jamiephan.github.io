import { describe, expect, it } from "vite-plus/test";
import { clamp, degToRad, lerp, perFrameAt60, scrollProgress } from "./math.ts";

describe("scene math", () => {
  it("converts degrees to radians", () => {
    expect(degToRad(180)).toBeCloseTo(Math.PI);
    expect(degToRad(90)).toBeCloseTo(Math.PI / 2);
  });

  it("clamps values", () => {
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(2, 0, 1)).toBe(1);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });

  it("computes scroll progress over the scrollable range only", () => {
    expect(scrollProgress(0, 3000, 1000)).toBe(0);
    expect(scrollProgress(1000, 3000, 1000)).toBe(0.5);
    // Bottom of the page is reached at scrollHeight - viewportHeight.
    expect(scrollProgress(2000, 3000, 1000)).toBe(1);
    // Over-scroll (e.g. iOS rubber-banding) stays in range.
    expect(scrollProgress(2400, 3000, 1000)).toBe(1);
    expect(scrollProgress(-50, 3000, 1000)).toBe(0);
  });

  it("returns 0 progress for pages that don't scroll", () => {
    expect(scrollProgress(0, 800, 800)).toBe(0);
    expect(scrollProgress(0, 500, 800)).toBe(0);
  });

  it("interpolates linearly", () => {
    expect(lerp(25, 50, 0)).toBe(25);
    expect(lerp(25, 50, 1)).toBe(50);
    expect(lerp(25, 50, 0.5)).toBe(37.5);
  });

  it("scales per-frame amounts by elapsed time", () => {
    expect(perFrameAt60(1, 1 / 60)).toBeCloseTo(1);
    expect(perFrameAt60(1, 1 / 120)).toBeCloseTo(0.5);
    expect(perFrameAt60(0.2, 1)).toBeCloseTo(12);
  });
});

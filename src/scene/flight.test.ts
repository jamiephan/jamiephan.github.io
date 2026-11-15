import { Vector3 } from "three";
import { describe, expect, it } from "vite-plus/test";
import { sweepSphere } from "./flight.ts";

const origin = new Vector3(0, 0, 0);

describe("sweepSphere", () => {
  it("finds where a path first touches the sphere", () => {
    const t = sweepSphere(new Vector3(-10, 0, 0), new Vector3(10, 0, 0), origin, 2);
    expect(t).toBeCloseTo(0.4); // x = -2
  });

  it("catches a fast move that would end on the far side (no tunnelling)", () => {
    // One boosted frame jumping clean over a Moon-sized sphere.
    expect(sweepSphere(new Vector3(-3, 0, 0), new Vector3(5, 0, 0), origin, 2.1)).not.toBeNull();
  });

  it("ignores paths that stop short, miss, or move away", () => {
    expect(sweepSphere(new Vector3(-10, 0, 0), new Vector3(-5, 0, 0), origin, 2)).toBeNull();
    expect(sweepSphere(new Vector3(-10, 3, 0), new Vector3(10, 3, 0), origin, 2)).toBeNull();
    expect(sweepSphere(new Vector3(-3, 0, 0), new Vector3(-10, 0, 0), origin, 2)).toBeNull();
    expect(sweepSphere(new Vector3(-3, 0, 0), new Vector3(-3, 0, 0), origin, 2)).toBeNull();
  });

  it("leaves paths starting inside to the push-out", () => {
    expect(sweepSphere(new Vector3(-1, 0, 0), new Vector3(5, 0, 0), origin, 2)).toBeNull();
  });
});

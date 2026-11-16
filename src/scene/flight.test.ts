import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vite-plus/test";
import { deviceQuaternion, speedScale, sweepSphere } from "./flight.ts";

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

describe("deviceQuaternion", () => {
  const forward = (alpha: number, beta: number, gamma: number, screenAngle = 0) =>
    new Vector3(0, 0, -1).applyQuaternion(
      deviceQuaternion(alpha, beta, gamma, screenAngle, new Quaternion()),
    );

  it("looks at the horizon when the phone is held upright", () => {
    const f = forward(0, 90, 0);
    expect(f.y).toBeCloseTo(0); // y is up in the device frame
    expect(f.length()).toBeCloseTo(1);
  });

  it("looks straight down when the phone lies flat on a table", () => {
    expect(forward(0, 0, 0).y).toBeCloseTo(-1);
  });

  it("turns the view when the phone turns on the spot", () => {
    const north = forward(0, 90, 0);
    const turned = forward(90, 90, 0);
    expect(north.dot(turned)).toBeCloseTo(0); // a quarter turn apart
    expect(turned.y).toBeCloseTo(0); // still level
  });

  it("keeps the view level in landscape", () => {
    // Held sideways (rotated a quarter turn), upright, with the screen rotated to match.
    const up = new Vector3(0, 1, 0).applyQuaternion(
      deviceQuaternion(0, 0, -90, 90, new Quaternion()),
    );
    expect(up.y).toBeCloseTo(1);
  });
});

describe("speedScale", () => {
  it("grows in proportion to the gap close to a surface", () => {
    expect(speedScale(0.08, 40) / speedScale(0.04, 40)).toBeCloseTo(2, 1);
  });

  it("grows faster than the gap higher up", () => {
    expect(speedScale(20, 4) / speedScale(10, 4)).toBeGreaterThan(3);
  });

  it("climbs the same way at any size of body, relative to its radius", () => {
    const small = speedScale(0.5, 1) / speedScale(0.25, 1);
    const large = speedScale(5, 10) / speedScale(2.5, 10);
    expect(small).toBeCloseTo(large);
  });

  it("stays within its limits", () => {
    expect(speedScale(0, 4)).toBeGreaterThan(0);
    expect(speedScale(1e6, 4)).toBe(speedScale(1e7, 4));
  });
});

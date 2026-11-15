import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vite-plus/test";
import { deviceQuaternion, sweepSphere } from "./flight.ts";

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

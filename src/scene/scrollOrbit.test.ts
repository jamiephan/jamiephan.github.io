import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vite-plus/test";

import { SUN_DIRECTION } from "./layout.ts";
import { SUN_ON_SCREEN, scrollOrbitFor } from "./scrollOrbit.ts";

const FOV = 60;
const tan = Math.tan((FOV * Math.PI) / 360);

/** The Sun's direction in the camera's frame part-way (`turn` 0–1) through the swing. */
const sunInView = (aspect: number, turn: number) => {
  const { azimuth, elevation } = scrollOrbitFor(aspect, FOV);
  const orbit = new Quaternion()
    .setFromAxisAngle(new Vector3(0, 0, 1), azimuth * turn)
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -elevation * turn));
  return SUN_DIRECTION.clone().applyQuaternion(orbit.invert());
};

const onScreen = (aspect: number) => {
  const v = sunInView(aspect, 1);
  expect(v.y).toBeGreaterThan(0);
  return { x: v.x / v.y / (tan * aspect), y: v.z / v.y / tan };
};

describe("scroll orbit", () => {
  it.each([16 / 9, 4 / 3, 21 / 9, 1])("ends with the Sun top right in landscape (%f)", (aspect) => {
    const { x, y } = onScreen(aspect);
    expect(x).toBeCloseTo(SUN_ON_SCREEN.landscape.x, 3);
    expect(y).toBeCloseTo(SUN_ON_SCREEN.landscape.y, 3);
  });

  it.each([9 / 19.5, 9 / 16, 3 / 4])("ends with the Sun top left in portrait (%f)", (aspect) => {
    const { x, y } = onScreen(aspect);
    expect(x).toBeCloseTo(SUN_ON_SCREEN.portrait.x, 3);
    expect(y).toBeCloseTo(SUN_ON_SCREEN.portrait.y, 3);
  });

  it("swings the Sun behind the camera on the way in portrait, but not in landscape", () => {
    const passesBehind = (aspect: number) =>
      Array.from({ length: 101 }, (_, i) => sunInView(aspect, i / 100)).some(
        (v) => v.y < 0 && Math.abs(v.x) < 0.1,
      );
    expect(passesBehind(9 / 19.5)).toBe(true);
    expect(passesBehind(16 / 9)).toBe(false);
  });
});

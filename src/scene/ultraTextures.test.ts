import { SphereGeometry, Vector2, Vector3 } from "three";
import { describe, expect, it } from "vite-plus/test";

import { ULTRA_MAPS } from "./textures.ts";
import {
  ULTRA_COLUMNS,
  ULTRA_ROWS,
  WINDOW_TILES,
  placeWindow,
  sphereUv,
  type WindowPlace,
} from "./ultraTextures.ts";

const uvAt = (x: number, y: number) => new Vector2(x / ULTRA_COLUMNS, y / ULTRA_ROWS);

describe("sphereUv", () => {
  it("matches SphereGeometry's texture coordinates", () => {
    const geometry = new SphereGeometry(3, 16, 8);
    const position = geometry.getAttribute("position");
    const uv = geometry.getAttribute("uv");
    const n = new Vector3();
    const out = new Vector2();
    for (let i = 0; i < position.count; i++) {
      n.fromBufferAttribute(position, i);
      const v = uv.getY(i);
      // Longitude is undefined at the poles and u = 1 is the same meridian as u = 0.
      if (v < 1e-6 || v > 1 - 1e-6) continue;
      sphereUv(n, out);
      expect(out.y).toBeCloseTo(v, 5);
      expect((out.x - uv.getX(i) + 1.5) % 1).toBeCloseTo(0.5, 5);
    }
  });
});

describe("placeWindow", () => {
  it("centres a new window on the view", () => {
    expect(placeWindow(uvAt(8.5, 4.5), null)).toEqual({ col: 7, row: 3 });
  });

  it("wraps round in longitude", () => {
    expect(placeWindow(uvAt(0.5, 4.5), null)).toEqual({ col: ULTRA_COLUMNS - 1, row: 3 });
  });

  it("stops at the poles", () => {
    expect(placeWindow(uvAt(5, 0.2), null).row).toBe(0);
    expect(placeWindow(uvAt(5, ULTRA_ROWS - 0.2), null).row).toBe(ULTRA_ROWS - WINDOW_TILES);
  });

  it("keeps the current window while the view stays in its middle", () => {
    const current: WindowPlace = { col: 7, row: 3 };
    expect(placeWindow(uvAt(9.9, 5.9), current)).toBe(current);
    expect(placeWindow(uvAt(10.1, 5), current)).not.toBe(current);
    // Straddling the seam.
    const seam: WindowPlace = { col: 14, row: 2 };
    expect(placeWindow(uvAt(0.5, 4), seam)).toBe(seam);
  });

  it("keeps a window at a pole however close to it the view gets", () => {
    const south: WindowPlace = { col: 3, row: 0 };
    expect(placeWindow(uvAt(5, 0.1), south)).toBe(south);
  });
});

describe("ultra tiles", () => {
  // Only the file names are needed; nothing is imported.
  const files = new Set(
    Object.keys(import.meta.glob("../../public/textures/ultra/*/*.webp")).map((path) =>
      path.slice("../../public/textures/ultra/".length),
    ),
  );

  it.each(ULTRA_MAPS)("has every tile of %s", (name) => {
    const missing = [];
    for (let row = 0; row < ULTRA_ROWS; row++) {
      for (let col = 0; col < ULTRA_COLUMNS; col++) {
        if (!files.has(`${name}/${col}-${row}.webp`)) missing.push(`${col}-${row}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

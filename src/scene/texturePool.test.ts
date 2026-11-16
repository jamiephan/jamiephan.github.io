import { NoColorSpace, SRGBColorSpace, Texture } from "three";
import { describe, expect, it, vi } from "vite-plus/test";
import { TexturePool } from "./texturePool.ts";

const make = (width = 8, height = 4, srgb = true): Texture => {
  const texture = new Texture({ width, height });
  texture.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  return texture;
};

describe("TexturePool", () => {
  it("hands a released texture back out for the same kind of map", () => {
    const pool = new TexturePool();
    const first = pool.acquire(() => make());
    pool.release(first);
    expect(pool.acquire(() => make())).toBe(first);
    expect(pool.size).toBe(0);
  });

  it("disposes the unneeded new texture when reusing one", () => {
    const pool = new TexturePool();
    pool.release(make());
    const spare = make();
    const dispose = vi.spyOn(spare, "dispose");
    pool.acquire(() => spare);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("never hands out a texture of a different size or format", () => {
    const pool = new TexturePool();
    const srgb = make();
    pool.release(srgb);
    expect(pool.acquire(() => make(8, 4, false))).not.toBe(srgb);
    expect(pool.acquire(() => make(16, 8))).not.toBe(srgb);
    expect(pool.size).toBe(1);
  });

  it("deletes textures left unused for too long", () => {
    const pool = new TexturePool(10);
    const texture = make();
    const dispose = vi.spyOn(texture, "dispose");
    pool.release(texture);
    pool.step(9);
    expect(pool.size).toBe(1);
    pool.step(2);
    expect(pool.size).toBe(0);
    expect(dispose).toHaveBeenCalledOnce();
  });
});

import type { Texture } from "three";

/**
 * Keeps big GPU textures for reuse instead of deleting and re-creating them. Allocating one is
 * what stalls: on a desktop GPU an 8K map (~170 MB with mipmaps) took 25–55 ms before its first
 * strip could go in, a 4K ultra window 13–27 ms, while rewriting one already allocated took
 * ~0.5 ms. Released textures wait here, keyed by everything that fixes their GPU storage and
 * sampling, and are handed out again for the next map of the same kind. Ones left unused for a
 * while are deleted, so memory isn't held for long after leaving a body.
 */
export class TexturePool {
  readonly #free = new Map<string, { texture: Texture; since: number }[]>();
  readonly #idleSeconds: number;
  #time = 0;

  /** @param idleSeconds Delete textures that have waited this long unused. */
  constructor(idleSeconds = 30) {
    this.#idleSeconds = idleSeconds;
  }

  /** A free texture made the same way as `create` would make it, or a new one. */
  acquire(create: () => Texture): Texture {
    const texture = create();
    const free = this.#free.get(keyOf(texture));
    const reused = free?.pop()?.texture;
    if (!reused) return texture;
    texture.dispose(); // never uploaded: nothing on the GPU yet
    return reused;
  }

  /** Hand a texture back for reuse; its contents are kept but will be overwritten. */
  release(texture: Texture): void {
    const key = keyOf(texture);
    let free = this.#free.get(key);
    if (!free) this.#free.set(key, (free = []));
    free.push({ texture, since: this.#time });
  }

  /** Advance the clock; deletes textures that have waited too long. */
  step(seconds: number): void {
    this.#time += seconds;
    for (const [key, free] of this.#free) {
      const keep = free.filter(({ texture, since }) => {
        if (this.#time - since < this.#idleSeconds) return true;
        texture.dispose();
        return false;
      });
      if (keep.length === 0) this.#free.delete(key);
      else if (keep.length !== free.length) this.#free.set(key, keep);
    }
  }

  /** How many textures are waiting. */
  get size(): number {
    let count = 0;
    for (const free of this.#free.values()) count += free.length;
    return count;
  }

  dispose(): void {
    for (const free of this.#free.values()) for (const { texture } of free) texture.dispose();
    this.#free.clear();
  }
}

/** Everything that fixes a texture's GPU storage and sampling. */
const keyOf = (texture: Texture): string => {
  const { width, height } = texture.image as { width: number; height: number };
  return [
    width,
    height,
    texture.format,
    texture.type,
    texture.colorSpace,
    texture.generateMipmaps,
    texture.minFilter,
    texture.magFilter,
    texture.wrapS,
    texture.wrapT,
    texture.anisotropy,
  ].join(":");
};

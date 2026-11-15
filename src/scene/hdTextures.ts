import type { ImageBitmapLoader, Texture } from "three";
import type { BodyId } from "./bodies.ts";

/**
 * Point a texture at a new image. three.js allocates a texture's GPU storage once, at its
 * first image's size; a bigger image (preview → full → HD) would fail to upload into it
 * (GL_INVALID_VALUE) and leave the old one showing. Releasing the GPU copy first makes the
 * next render allocate at the new size; the Texture object itself stays usable.
 */
export const replaceImage = (texture: Texture, image: ImageBitmap): void => {
  const previous = texture.image as { width?: number; height?: number } | null;
  if (previous && (previous.width !== image.width || previous.height !== image.height)) {
    texture.dispose();
  }
  texture.image = image;
  texture.needsUpdate = true;
};

interface Entry {
  texture: Texture;
  body: BodyId;
  url: string;
  /** The image shown when this body isn't the one in HD (preview, then full resolution). */
  base: ImageBitmap | null;
  hd: ImageBitmap | null;
  loading: boolean;
}

/**
 * Highest-resolution maps (up to 8K) for one body at a time: the one being explored or flown
 * close to. A single 8K map takes ~170 MB of GPU memory with mipmaps, far too much to hold
 * for every planet at once, so leaving a body drops it back to its usual map.
 */
export class HdTextures {
  readonly #entries = new Map<Texture, Entry>();
  readonly #enabled: boolean;
  readonly #createLoader: () => ImageBitmapLoader;
  readonly #onChange: () => void;
  #active: BodyId | null = null;
  #disposed = false;

  /**
   * @param enabled Whether this device can take it (texture size limit, memory).
   * @param onChange Called when a texture's image changes, so the scene redraws.
   */
  constructor(enabled: boolean, createLoader: () => ImageBitmapLoader, onChange: () => void) {
    this.#enabled = enabled;
    this.#createLoader = createLoader;
    this.#onChange = onChange;
  }

  /** The body currently in HD, if any. */
  get active(): BodyId | null {
    return this.#active;
  }

  register(texture: Texture, body: BodyId, url: string): void {
    this.#entries.set(texture, { texture, body, url, base: null, hd: null, loading: false });
  }

  /**
   * Give a registered texture its usual (non-HD) image. Returns false for textures this
   * doesn't manage, which the caller then updates itself.
   */
  setBase(texture: Texture, image: ImageBitmap): boolean {
    const entry = this.#entries.get(texture);
    if (!entry) return false;
    const previous = entry.base;
    entry.base = image;
    // While the HD map is showing, the new image just waits until the body is left.
    if (!entry.hd) this.#show(entry, image);
    previous?.close();
    return true;
  }

  /** Switch HD to this body (or none), loading its maps and releasing the previous body's. */
  setActive(body: BodyId | null): void {
    if (!this.#enabled || body === this.#active) return;
    this.#active = body;
    for (const entry of this.#entries.values()) {
      if (entry.body === body) this.#load(entry);
      else this.#release(entry);
    }
  }

  dispose(): void {
    this.#disposed = true;
    for (const entry of this.#entries.values()) {
      entry.base?.close();
      entry.hd?.close();
    }
  }

  #load(entry: Entry): void {
    if (entry.hd || entry.loading) return;
    entry.loading = true;
    this.#createLoader().load(
      entry.url,
      (image) => {
        entry.loading = false;
        // Moved on (or gone) while it downloaded.
        if (this.#disposed || this.#active !== entry.body) {
          image.close();
          return;
        }
        entry.hd = image;
        this.#show(entry, image);
      },
      undefined,
      () => {
        entry.loading = false;
        console.warn(`Failed to load texture: ${entry.url}`);
      },
    );
  }

  #release(entry: Entry): void {
    const hd = entry.hd;
    // Without a usual image to go back to (still loading), keep showing the HD one.
    if (!hd || !entry.base) return;
    entry.hd = null;
    this.#show(entry, entry.base);
    hd.close();
  }

  #show(entry: Entry, image: ImageBitmap): void {
    replaceImage(entry.texture, image);
    this.#onChange();
  }
}

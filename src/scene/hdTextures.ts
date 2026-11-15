import { Box2, Texture, Vector2 } from "three";
import type { ImageBitmapLoader, WebGLRenderer } from "three";
import type { BodyId } from "./bodies.ts";

/**
 * Point a texture at a new image. three.js allocates a texture's GPU storage once, at its
 * first image's size; a bigger image (preview → full) would fail to upload into it
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

/**
 * Bytes of an HD map to send to the GPU per frame. An 8K map is 128 MB; uploading it in one
 * go stalls that frame for a long time, so it goes up in strips of rows instead.
 */
const UPLOAD_BYTES_PER_FRAME = 8 * 1024 * 1024;

/** An HD map on its way to the GPU, a strip of rows each frame. */
interface Upload {
  /** Wraps the decoded image as a copy source; never uploaded itself. */
  source: Texture<ImageBitmap>;
  /** Receives the strips; shown once it's complete. */
  target: Texture;
  /** Rows copied so far. */
  row: number;
}

interface Entry {
  /** The texture the materials were built with, holding the usual (preview/full) map. */
  texture: Texture;
  body: BodyId;
  url: string;
  /** The complete HD map, while it's the one showing. */
  hd: Texture | null;
  upload: Upload | null;
  loading: boolean;
}

/**
 * Highest-resolution maps (up to 8K) for one body at a time: the one being explored or flown
 * close to. A single 8K map takes ~170 MB of GPU memory with mipmaps, far too much to hold
 * for every planet at once, so leaving a body drops it back to its usual map.
 *
 * The HD map is a separate texture, filled over several frames (see `step`) and then swapped
 * in for the usual one. The usual one stays on the GPU, so going back to it costs nothing.
 */
export class HdTextures {
  readonly #entries = new Map<Texture, Entry>();
  readonly #enabled: boolean;
  readonly #renderer: WebGLRenderer;
  readonly #createLoader: () => ImageBitmapLoader;
  readonly #swap: (from: Texture, to: Texture) => void;
  readonly #onChange: () => void;
  readonly #region = new Box2();
  readonly #position = new Vector2();
  #active: BodyId | null = null;
  #disposed = false;

  /**
   * @param enabled Whether this device can take it (texture size limit, memory).
   * @param swap Points every material using `from` at `to` instead.
   * @param onChange Called when a body's maps change, so the scene redraws.
   */
  constructor(
    enabled: boolean,
    renderer: WebGLRenderer,
    createLoader: () => ImageBitmapLoader,
    swap: (from: Texture, to: Texture) => void,
    onChange: () => void,
  ) {
    this.#enabled = enabled;
    this.#renderer = renderer;
    this.#createLoader = createLoader;
    this.#swap = swap;
    this.#onChange = onChange;
  }

  /** The body currently in HD, if any. */
  get active(): BodyId | null {
    return this.#active;
  }

  register(texture: Texture, body: BodyId, url: string): void {
    this.#entries.set(texture, { texture, body, url, hd: null, upload: null, loading: false });
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

  /** Send the next strip of a pending HD map to the GPU; called once a frame. */
  step(): void {
    for (const entry of this.#entries.values()) {
      const upload = entry.upload;
      if (!upload) continue;
      const { source, target } = upload;
      const { width, height } = source.image;
      if (upload.row === 0) this.#renderer.initTexture(target); // allocate only, no data
      const rows = Math.max(1, Math.floor(UPLOAD_BYTES_PER_FRAME / (width * 4)));
      const end = Math.min(height, upload.row + rows);
      // The last strip also builds the mipmaps (copyTextureToTexture does it when enabled).
      if (end === height) target.mipmapsAutoUpdate = true;
      this.#region.min.set(0, upload.row);
      this.#region.max.set(width, end);
      this.#renderer.copyTextureToTexture(
        source,
        target,
        this.#region,
        this.#position.set(0, upload.row),
      );
      upload.row = end;
      if (end === height) {
        source.image.close();
        entry.upload = null;
        entry.hd = target;
        this.#swap(entry.texture, target);
        this.#onChange();
      }
      return; // one strip per frame in total
    }
  }

  dispose(): void {
    this.#disposed = true;
    for (const entry of this.#entries.values()) {
      this.#cancelUpload(entry);
      entry.hd?.dispose();
    }
  }

  #load(entry: Entry): void {
    if (entry.hd || entry.upload || entry.loading) return;
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
        entry.upload = {
          source: new Texture(image),
          target: this.#createTarget(entry, image),
          row: 0,
        };
      },
      undefined,
      () => {
        entry.loading = false;
        console.warn(`Failed to load texture: ${entry.url}`);
      },
    );
  }

  /** An empty texture the size of `image`, sampled the same way as the usual one. */
  #createTarget(entry: Entry, image: ImageBitmap): Texture {
    const usual = entry.texture;
    const target = new Texture({ width: image.width, height: image.height });
    target.colorSpace = usual.colorSpace;
    target.wrapS = usual.wrapS;
    target.wrapT = usual.wrapT;
    target.magFilter = usual.magFilter;
    target.minFilter = usual.minFilter;
    target.generateMipmaps = usual.generateMipmaps;
    target.anisotropy = usual.anisotropy;
    target.flipY = false; // the loader already flips the bitmap
    // Allocate GPU storage without uploading anything; the strips fill it in.
    target.source.dataReady = false;
    // Mipmaps are built once, after the last strip.
    target.mipmapsAutoUpdate = false;
    target.needsUpdate = true;
    return target;
  }

  #cancelUpload(entry: Entry): void {
    if (!entry.upload) return;
    entry.upload.source.image.close();
    entry.upload.target.dispose();
    entry.upload = null;
  }

  #release(entry: Entry): void {
    this.#cancelUpload(entry);
    const hd = entry.hd;
    if (!hd) return;
    entry.hd = null;
    this.#swap(hd, entry.texture);
    hd.dispose();
    this.#onChange();
  }
}

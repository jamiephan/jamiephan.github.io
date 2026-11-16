import { Box2, Texture, Vector2 } from "three";
import type { WebGLRenderer } from "three";
import type { BodyId } from "./bodies.ts";
import type { DecodedImage, ImageDecoder } from "./imageDecoder.ts";
import type { TexturePool } from "./texturePool.ts";
import { blendUniformFor } from "./ultraTextures.ts";

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
 * go stalls that frame for a long time, so it goes up in strips of rows instead. From raw
 * pixels a strip this size takes ~1 ms on a desktop GPU.
 */
const UPLOAD_BYTES_PER_FRAME = 4 * 1024 * 1024;
/** Seconds for an HD map to sharpen once it's in, or soften before it's dropped. */
export const HD_FADE_SECONDS = 0.6;

/** An HD map on its way to the GPU, a strip of rows each frame. */
interface Upload {
  image: DecodedImage;
  /** Receives the strips; shown once it's complete. */
  target: Texture;
  /** Rows copied so far. */
  row: number;
}

/** The HD map's extra blur (mip levels), easing towards `to`. */
interface Fade {
  from: number;
  to: number;
  progress: number;
}

interface Entry {
  /** The texture the materials were built with, holding the usual (preview/full) map. */
  texture: Texture;
  body: BodyId;
  url: string;
  /** The complete HD map, while it's the one showing. */
  hd: Texture | null;
  upload: Upload | null;
  /** A decode in flight (compared on arrival, so a stale one is dropped). */
  loading: Promise<DecodedImage> | null;
  /** x: blur on the map showing, in mip levels (see `ultraTexture` in the shaders). */
  blend: { value: Vector2 };
  fade: Fade | null;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/**
 * Highest-resolution maps (up to 8K) for one body at a time: the one being explored or flown
 * close to. A single 8K map takes ~170 MB of GPU memory with mipmaps, far too much to hold
 * for every planet at once, so leaving a body drops it back to its usual map.
 *
 * Nothing about it should show as a hitch or a pop:
 * - The map is decoded off the main thread and copied to the GPU a small strip per frame, into
 *   a texture taken from a pool (allocating an 8K texture is what stalls a frame).
 * - Swapped in, it's first blurred to match the map it replaces (sampled the right number of
 *   mip levels down), then sharpens over `HD_FADE_SECONDS`. Leaving, it softens back first.
 * - The usual map stays on the GPU, so going back to it costs nothing.
 */
export class HdTextures {
  readonly #entries = new Map<Texture, Entry>();
  readonly #enabled: boolean;
  readonly #renderer: WebGLRenderer;
  readonly #decoder: ImageDecoder;
  readonly #pool: TexturePool;
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
    decoder: ImageDecoder,
    pool: TexturePool,
    swap: (from: Texture, to: Texture) => void,
    onChange: () => void,
  ) {
    this.#enabled = enabled;
    this.#renderer = renderer;
    this.#decoder = decoder;
    this.#pool = pool;
    this.#swap = swap;
    this.#onChange = onChange;
  }

  /** The body currently in HD, if any. */
  get active(): BodyId | null {
    return this.#active;
  }

  register(texture: Texture, body: BodyId, url: string): void {
    this.#entries.set(texture, {
      texture,
      body,
      url,
      hd: null,
      upload: null,
      loading: null,
      blend: blendUniformFor(texture),
      fade: null,
    });
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

  /**
   * Once a frame: ease any fades, and send the next strip of a pending HD map to the GPU.
   * @param seconds Time since the last frame.
   */
  step(seconds: number): void {
    for (const entry of this.#entries.values()) this.#stepFade(entry, seconds);
    for (const entry of this.#entries.values()) {
      const upload = entry.upload;
      if (!upload) continue;
      const { image, target } = upload;
      const { width, height } = image;
      if (upload.row === 0) this.#renderer.initTexture(target); // allocate only, no data
      const rows = Math.max(1, Math.floor(UPLOAD_BYTES_PER_FRAME / (width * 4)));
      const end = Math.min(height, upload.row + rows);
      // The last strip also builds the mipmaps (copyTextureToTexture does it when enabled).
      if (end === height) target.mipmapsAutoUpdate = true;
      this.#region.min.set(0, upload.row);
      this.#region.max.set(width, end);
      this.#renderer.copyTextureToTexture(
        image.source,
        target,
        this.#region,
        this.#position.set(0, upload.row),
      );
      upload.row = end;
      if (end === height) this.#show(entry, upload);
      return; // one strip per frame in total
    }
  }

  dispose(): void {
    this.#disposed = true;
    for (const entry of this.#entries.values()) {
      this.#cancelUpload(entry);
      entry.loading = null;
      entry.hd?.dispose();
      entry.hd = null;
    }
  }

  #load(entry: Entry): void {
    // Leaving it, but not gone yet: sharpen it again.
    if (entry.hd) {
      this.#fadeTo(entry, 0);
      return;
    }
    if (entry.upload || entry.loading) return;
    const loading = this.#decoder.decode(entry.url);
    entry.loading = loading;
    loading.then(
      (image) => {
        // Moved on (or gone) while it downloaded.
        if (entry.loading !== loading || this.#disposed || this.#active !== entry.body) {
          image.close();
          return;
        }
        entry.loading = null;
        entry.upload = { image, target: this.#acquireTarget(entry, image), row: 0 };
      },
      (error: unknown) => {
        if (entry.loading === loading) entry.loading = null;
        console.warn(`Failed to load texture: ${entry.url}`, error);
      },
    );
  }

  /** The complete map goes in, blurred to look just like the one it replaces, then sharpens. */
  #show(entry: Entry, { image, target }: Upload): void {
    image.close();
    entry.upload = null;
    entry.hd = target;
    this.#swap(entry.texture, target);
    const blur = this.#blurFor(entry, image.width);
    entry.blend.value.x = blur;
    entry.fade = { from: blur, to: 0, progress: 0 };
    this.#onChange();
  }

  /** An empty texture the size of `image`, sampled the same way as the usual one. */
  #acquireTarget(entry: Entry, image: DecodedImage): Texture {
    const target = this.#pool.acquire(() => {
      const usual = entry.texture;
      const texture = new Texture({ width: image.width, height: image.height });
      texture.colorSpace = usual.colorSpace;
      texture.wrapS = usual.wrapS;
      texture.wrapT = usual.wrapT;
      texture.magFilter = usual.magFilter;
      texture.minFilter = usual.minFilter;
      texture.generateMipmaps = usual.generateMipmaps;
      texture.anisotropy = usual.anisotropy;
      texture.flipY = false; // rows already come bottom-up
      // Allocate GPU storage without uploading anything; the strips fill it in.
      texture.source.dataReady = false;
      texture.needsUpdate = true;
      return texture;
    });
    // Mipmaps are built once, after the last strip.
    target.mipmapsAutoUpdate = false;
    return target;
  }

  /** Mip levels to blur an HD map `width` texels wide by to look like the usual map. */
  #blurFor(entry: Entry, width: number): number {
    const usual = (entry.texture.image as { width?: number } | null)?.width;
    return usual ? Math.max(0, Math.log2(width / usual)) : 0;
  }

  #fadeTo(entry: Entry, to: number): void {
    if (entry.fade?.to === to) return;
    const from = entry.blend.value.x;
    // Already there: finish on the next step (which drops the map if it's leaving).
    entry.fade = { from, to, progress: from === to ? 1 : 0 };
  }

  #stepFade(entry: Entry, seconds: number): void {
    const fade = entry.fade;
    if (!fade) return;
    fade.progress = Math.min(1, fade.progress + seconds / HD_FADE_SECONDS);
    entry.blend.value.x = fade.from + (fade.to - fade.from) * smooth(fade.progress);
    this.#onChange();
    if (fade.progress < 1) return;
    entry.fade = null;
    // Softened all the way: now it looks just like the usual map, which takes over.
    if (fade.to > 0 && entry.body !== this.#active) this.#drop(entry);
  }

  #cancelUpload(entry: Entry): void {
    if (!entry.upload) return;
    entry.upload.image.close();
    this.#pool.release(entry.upload.target);
    entry.upload = null;
  }

  /** Leaving the body: stop any loading, and soften the HD map before dropping it. */
  #release(entry: Entry): void {
    entry.loading = null;
    this.#cancelUpload(entry);
    const hd = entry.hd;
    if (!hd) return;
    const blur = this.#blurFor(entry, (hd.image as { width: number }).width);
    if (blur > 0) this.#fadeTo(entry, blur);
    else this.#drop(entry);
  }

  #drop(entry: Entry): void {
    const hd = entry.hd;
    if (!hd) return;
    entry.hd = null;
    entry.fade = null;
    entry.blend.value.x = 0;
    this.#swap(hd, entry.texture);
    this.#pool.release(hd);
    this.#onChange();
  }
}

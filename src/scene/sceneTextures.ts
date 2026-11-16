/**
 * Every image texture in the scene, through its levels of detail:
 *
 * 1. A small preview (`assets/textures/preview/`), loaded up front so the page shows quickly.
 * 2. The full-resolution file, swapped in once explore mode starts (`loadDetail`).
 * 3. Up-to-8K HD maps for the one body being looked at up close (`hd`, see `hdTextures.ts`).
 * 4. 16K maps streamed a window of tiles at a time (`ultra`, see `ultraTextures.ts`).
 *
 * Images are decoded to bitmaps off the main thread. Once the scene is showing they go to the
 * GPU one per frame (`step`), so swapping in a whole set doesn't stall a frame.
 */
import {
  ImageBitmapLoader,
  LoadingManager,
  Mesh,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  ShaderMaterial,
  Texture,
  type Object3D,
  type WebGLRenderer,
} from "three";

import type { BodyId } from "./bodies.ts";
import { HdTextures, replaceImage } from "./hdTextures.ts";
import { hdFor, previewFor, ultraFor } from "./textures.ts";
import { UltraTextures } from "./ultraTextures.ts";

/** HD maps are up to 8K wide: only on devices that take that size and have memory to spare. */
const HD_TEXTURE_SIZE = 8192;
const HD_MIN_DEVICE_MEMORY_GB = 4;
/** Ultra maps take up to ~450 MB more GPU memory (the Earth's five maps): only where there's plenty. */
const ULTRA_MIN_DEVICE_MEMORY_GB = 8;

export interface LoadOptions {
  /** Colour data (sRGB) rather than numbers (normals, masks). */
  color?: boolean;
  /** Anisotropic filtering, for surfaces seen at grazing angles. */
  sharp?: boolean;
  /** Repeat in longitude (globe maps). */
  wrap?: boolean;
  /** The body this map covers, to give it HD and ultra levels where there are any. */
  body?: BodyId;
  /** The full-resolution file is HD-sized (8K): skip it where HD maps are skipped. */
  hdSized?: boolean;
}

export type LoadTexture = (url: string, options?: LoadOptions) => Texture;

/**
 * Images are decoded to bitmaps off the main thread. Decoding an `<img>` happens during the
 * WebGL upload instead, which blocked the page for hundreds of milliseconds on slower phones.
 */
const createImageLoader = (manager?: LoadingManager): ImageBitmapLoader =>
  new ImageBitmapLoader(manager).setOptions({
    imageOrientation: "flipY",
    premultiplyAlpha: "none",
  });

export class SceneTextures {
  /** Resolves once every preview (or file without one) has arrived. */
  readonly loaded: Promise<void>;
  /** Up-to-8K maps for the one body being looked at up close. */
  readonly hd: HdTextures;
  /** 16K maps, a window of tiles at a time, for the body flown or zoomed right up to. */
  readonly ultra: UltraTextures;

  readonly #renderer: WebGLRenderer;
  readonly #root: Object3D;
  readonly #onChange: () => void;
  readonly #loader: ImageBitmapLoader;
  readonly #anisotropy: number;
  readonly #hdCapable: boolean;
  readonly #textures: Texture[] = [];
  /** Textures showing a low-res preview, and the full-resolution file to swap in later. */
  #pendingDetail: { texture: Texture; url: string }[] = [];
  /**
   * Images waiting to go to the GPU once the scene is showing: one per frame, since uploading
   * a whole set at once (entering explore mode) stalled a frame for ~350 ms.
   */
  readonly #uploads: { texture: Texture; image: ImageBitmap }[] = [];
  #showing = false;
  #disposed = false;

  /**
   * @param root Everything drawn: materials sampling a texture are re-pointed when its HD
   *   version comes and goes.
   * @param onChange Called whenever a texture changes, so the next frame shows it.
   */
  constructor(renderer: WebGLRenderer, root: Object3D, onChange: () => void) {
    this.#renderer = renderer;
    this.#root = root;
    this.#onChange = onChange;

    let resolveLoaded!: () => void;
    this.loaded = new Promise<void>((resolve) => (resolveLoaded = resolve));
    const manager = new LoadingManager(resolveLoaded);
    manager.onError = (url) => console.warn(`Failed to load texture: ${url}`);
    this.#loader = createImageLoader(manager);

    const { capabilities } = renderer;
    this.#anisotropy = Math.min(8, capabilities.getMaxAnisotropy());
    // `deviceMemory` is Chromium-only (and rounded); elsewhere, trust the texture size limit.
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    this.#hdCapable =
      capabilities.maxTextureSize >= HD_TEXTURE_SIZE &&
      (memory ?? Infinity) >= HD_MIN_DEVICE_MEMORY_GB;
    this.hd = new HdTextures(
      this.#hdCapable,
      renderer,
      () => createImageLoader(),
      (from, to) => this.#swap(from, to),
      onChange,
    );
    // Browsers without `deviceMemory` (Firefox, Safari) include phones: leave them at HD.
    this.ultra = new UltraTextures(
      this.#hdCapable && (memory ?? 0) >= ULTRA_MIN_DEVICE_MEMORY_GB,
      renderer,
      () => createImageLoader(),
      onChange,
    );
  }

  /** A texture showing `url` (its preview first, if it has one). */
  readonly load: LoadTexture = (
    url,
    { color = true, sharp = false, wrap = true, body, hdSized = false } = {},
  ) => {
    // Start with the small preview if there is one; `loadDetail` fetches the rest later.
    const preview = previewFor(url);
    const texture = new Texture();
    texture.flipY = false; // the loader already flips the bitmap
    this.#loader.load(preview ?? url, (image) => this.#setImage(texture, image));
    if (preview && (this.#hdCapable || !hdSized)) this.#pendingDetail.push({ texture, url });
    const hd = body && hdFor(url);
    if (body && hd) this.hd.register(texture, body, hd);
    const ultra = body && ultraFor(url);
    if (body && ultra) this.ultra.register(texture, body, ultra);
    texture.colorSpace = color ? SRGBColorSpace : NoColorSpace;
    if (sharp) texture.anisotropy = this.#anisotropy;
    // Globe maps wrap round in longitude. Clamping would draw a seam where u meets 0/1 (the
    // bump lookups straddle it) and smear the edge column into streaks wherever a lookup is
    // shifted past it (the Earth's cloud shadows, which drift with the clouds).
    if (wrap) texture.wrapS = RepeatWrapping;
    this.#textures.push(texture);
    return texture;
  };

  /** Call once the scene is built: ultra maps need to know which object each one covers. */
  bindFrames(): void {
    this.ultra.bindFrames(this.#root);
  }

  /**
   * From now on, images go to the GPU one per frame. Before this, while the canvas is still
   * hidden, they're all applied at once (the first frame, drawn hidden, uploads them).
   */
  startShowing(): void {
    this.#showing = true;
  }

  /**
   * Swap the preview textures for full resolution. Only done once someone starts exploring and
   * can zoom in, so a normal visit never downloads the large files.
   */
  loadDetail(): void {
    if (this.#pendingDetail.length === 0) return;
    const loader = createImageLoader();
    for (const { texture, url } of this.#pendingDetail) {
      loader.load(url, (image) => this.#setImage(texture, image));
    }
    this.#pendingDetail = [];
  }

  /** Once a frame: upload the next queued image and advance the HD and ultra levels. */
  step(): void {
    const next = this.#uploads.shift();
    if (next) {
      this.#apply(next.texture, next.image);
      // Upload it now, so its cost lands in this frame rather than piling onto a later one.
      this.#renderer.initTexture(next.texture);
    }
    this.hd.step();
    this.ultra.step();
  }

  dispose(): void {
    this.#disposed = true;
    for (const texture of this.#textures) {
      texture.dispose();
      if (texture.image instanceof ImageBitmap) texture.image.close();
    }
    this.hd.dispose();
    this.ultra.dispose();
    for (const { image } of this.#uploads) image.close();
    this.#uploads.length = 0;
  }

  /** Give a texture its (new) image; it is uploaded on the next render. */
  #setImage(texture: Texture, image: ImageBitmap): void {
    if (this.#disposed) {
      image.close();
      return;
    }
    if (this.#showing) {
      this.#uploads.push({ texture, image });
      return;
    }
    this.#apply(texture, image);
  }

  #apply(texture: Texture, image: ImageBitmap): void {
    const previous = texture.image;
    replaceImage(texture, image);
    if (previous instanceof ImageBitmap) previous.close();
    this.#onChange();
  }

  /** Point every material that samples `from` at `to` instead (HD maps in and out). */
  #swap(from: Texture, to: Texture): void {
    this.#root.traverse((object) => {
      const material = (object as Partial<Mesh>).material;
      for (const m of Array.isArray(material) ? material : material ? [material] : []) {
        if (!(m instanceof ShaderMaterial)) continue;
        for (const uniform of Object.values(m.uniforms)) {
          if (uniform.value === from) uniform.value = to;
        }
      }
    });
  }
}

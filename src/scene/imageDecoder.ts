/**
 * Large images for streaming to the GPU a strip at a time (HD maps, ultra tiles).
 *
 * They're decoded to raw pixels in workers: copying rows from an `ImageBitmap` to a texture
 * cost ~6.5 ms per 8 MB on a desktop GPU (browsers process the bitmap on every partial copy),
 * from raw pixels ~2 ms. Where a worker can't decode (no `OffscreenCanvas`), falls back to an
 * `ImageBitmap`, which three.js copies from the same way.
 */
import { DataTexture, ImageBitmapLoader, Texture } from "three";

export interface DecodedImage {
  width: number;
  height: number;
  /** A copy source for `renderer.copyTextureToTexture` (never uploaded itself). */
  source: Texture;
  /** Release the decoded pixels. */
  close(): void;
}

interface Reply {
  id: number;
  width?: number;
  height?: number;
  pixels?: ArrayBuffer;
  error?: string;
}

/** Two workers: an 8K map takes ~150 ms to decode, and tiles shouldn't queue behind it. */
const WORKERS = 2;

class WorkerDecoder {
  readonly #workers: { worker: Worker; busy: number }[] = [];
  readonly #pending = new Map<
    number,
    { resolve: (image: DecodedImage) => void; reject: (error: Error) => void; slot: number }
  >();
  #nextId = 0;

  constructor() {
    for (let slot = 0; slot < WORKERS; slot++) {
      const worker = new Worker(new URL("./imageDecoder.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = ({ data }: MessageEvent<Reply>) => this.#reply(data);
      this.#workers.push({ worker, busy: 0 });
    }
  }

  decode(url: string): Promise<DecodedImage> {
    // The least busy worker.
    const slot = this.#workers.reduce(
      (best, entry, index) => (entry.busy < this.#workers[best]!.busy ? index : best),
      0,
    );
    const id = this.#nextId++;
    const entry = this.#workers[slot]!;
    entry.busy++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, slot });
      entry.worker.postMessage({ id, url: new URL(url, document.baseURI).href });
    });
  }

  dispose(): void {
    for (const { worker } of this.#workers) worker.terminate();
    for (const { reject } of this.#pending.values()) reject(new Error("Decoder disposed"));
    this.#pending.clear();
  }

  #reply({ id, width, height, pixels, error }: Reply): void {
    const pending = this.#pending.get(id);
    if (!pending) return;
    this.#pending.delete(id);
    this.#workers[pending.slot]!.busy--;
    if (error || !pixels || !width || !height) {
      pending.reject(new Error(error ?? "No pixels"));
      return;
    }
    const source = new DataTexture(new Uint8Array(pixels), width, height);
    pending.resolve({ width, height, source, close: () => source.dispose() });
  }
}

const decodeBitmap = (url: string): Promise<DecodedImage> =>
  new Promise((resolve, reject) => {
    new ImageBitmapLoader()
      .setOptions({ imageOrientation: "flipY", premultiplyAlpha: "none" })
      .load(
        url,
        (image) => {
          const source = new Texture(image);
          source.flipY = false; // the loader already flips the bitmap
          resolve({
            width: image.width,
            height: image.height,
            source,
            close: () => image.close(),
          });
        },
        undefined,
        () => reject(new Error(`Failed to load texture: ${url}`)),
      );
  });

/** Decodes images for streaming uploads; shared by the HD and ultra levels. */
export class ImageDecoder {
  #workers: WorkerDecoder | null = null;
  /** Off once a worker has failed to decode (no `OffscreenCanvas`): bitmaps from then on. */
  #useWorkers = typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined";

  async decode(url: string): Promise<DecodedImage> {
    if (this.#useWorkers) {
      try {
        this.#workers ??= new WorkerDecoder();
        return await this.#workers.decode(url);
      } catch (error) {
        // A missing file would fail the same way below; anything else means the worker can't.
        if (String(error).includes("HTTP ")) throw error;
        console.warn("Decoding in a worker failed; falling back to the main thread", error);
        this.#useWorkers = false;
      }
    }
    return decodeBitmap(url);
  }

  dispose(): void {
    this.#workers?.dispose();
    this.#workers = null;
  }
}

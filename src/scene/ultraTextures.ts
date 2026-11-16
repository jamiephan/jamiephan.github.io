import { Box2, MathUtils, Mesh, ShaderMaterial, Texture, Vector2, Vector3, Vector4 } from "three";
import type { Object3D, WebGLRenderer } from "three";
import type { BodyId } from "./bodies.ts";
import type { DecodedImage, ImageDecoder } from "./imageDecoder.ts";
import type { TexturePool } from "./texturePool.ts";

/**
 * Ultra-HD level of detail: 16K versions of the globe maps, for flying low over a surface or
 * zooming right in, where even the 8K HD map is magnified. A 16K map is far too big to hold
 * whole (it's beyond many GPUs' texture size limit, and ~700 MB with mipmaps), and close up only
 * a patch of the surface is in view anyway. So each map is stored as a grid of tiles (see
 * `ultraFor` in `textures.ts`) and only a window of them around the point being looked at is
 * put together on the GPU, then laid over the usual map in the shader (`ultraTexture` in
 * `shaders/chunks/ultra.glsl`). The window follows the view, a tile at a time.
 *
 * Window textures come from a pool (allocating a 4K texture stalls a frame for 13-27 ms), so
 * once a map has had two, moving its window allocates nothing. Tiles are decoded off the main
 * thread. A window fades in when it first appears and out when it's no longer needed, rather
 * than popping.
 */

/** The full map: 16384×8192 in 1024² tiles. */
export const ULTRA_TILE = 1024;
export const ULTRA_COLUMNS = 16;
export const ULTRA_ROWS = 8;
/** The window, in tiles: 4096² texels, 90° by 90° of the globe. */
export const WINDOW_TILES = 4;
/** Tile copies to the GPU per frame (4 MB each). */
const TILES_PER_FRAME = 1;
/** Seconds for a window to fade in when it first appears, or out when it's dropped. */
export const ULTRA_FADE_SECONDS = 0.5;

/** Shader uniforms for one map's window; shared by every material sampling that map. */
export interface UltraUniforms {
  map: { value: Texture | null };
  /** u0, v0, width, height of the window in texture coordinates; width 0 = no window. */
  rect: { value: Vector4 };
  /**
   * x: extra blur on the usual map, in mip levels (an HD map easing in or out; see
   * `hdTextures.ts`). y: how strongly the window shows, 0-1 (fading in or out).
   */
  blend: { value: Vector2 };
}

const uniformsByTexture = new WeakMap<Texture, UltraUniforms>();

const uniformsFor = (texture: Texture): UltraUniforms => {
  let uniforms = uniformsByTexture.get(texture);
  if (!uniforms) {
    uniforms = {
      map: { value: null },
      rect: { value: new Vector4() },
      blend: { value: new Vector2(0, 1) },
    };
    uniformsByTexture.set(texture, uniforms);
  }
  return uniforms;
};

/**
 * The ultra uniforms to put next to a map's own uniform `name` (`${name}Ultra`,
 * `${name}UltraRect`, `${name}Blend`), as `ultraTexture` in the shader expects them.
 */
export const ultraUniforms = (
  name: string,
  texture: Texture,
): Record<string, { value: unknown }> => {
  const uniforms = uniformsFor(texture);
  return {
    [`${name}Ultra`]: uniforms.map,
    [`${name}UltraRect`]: uniforms.rect,
    [`${name}Blend`]: uniforms.blend,
  };
};

/** The blend uniform of a map (see `UltraUniforms`), shared with its HD level. */
export const blendUniformFor = (texture: Texture): { value: Vector2 } => uniformsFor(texture).blend;

/**
 * Texture coordinates of a direction from a globe's centre, in its own frame: the mapping
 * `computeSphereUv` uses in the shaders (u from -x towards +z, v 0 south to 1 north).
 */
export const sphereUv = (n: Vector3, out = new Vector2()): Vector2 => {
  const length = n.length();
  const u = MathUtils.euclideanModulo(Math.atan2(n.z, -n.x) / (2 * Math.PI), 1);
  const v = 1 - Math.acos(MathUtils.clamp(n.y / length, -1, 1)) / Math.PI;
  return out.set(u, v);
};

/** Where a window sits, in tiles: its first column (wrapping round) and first row (from the south). */
export interface WindowPlace {
  col: number;
  row: number;
}

/**
 * The window to show for a view centred at texture coordinates `uv`. The current one is kept
 * while the centre stays within its middle tiles, so it doesn't move back and forth on a tile
 * edge; otherwise a new one is centred on it.
 */
export const placeWindow = (uv: Vector2, current: WindowPlace | null): WindowPlace => {
  const x = uv.x * ULTRA_COLUMNS;
  const y = uv.y * ULTRA_ROWS;
  const margin = (WINDOW_TILES - 2) / 2; // tiles kept either side of the centre
  if (current) {
    const dx = MathUtils.euclideanModulo(x - current.col, ULTRA_COLUMNS);
    const dy = y - current.row;
    const top = ULTRA_ROWS - WINDOW_TILES;
    const inX = dx >= margin && dx <= WINDOW_TILES - margin;
    // At a pole the window can't go further, so anything beyond its middle still counts.
    const inY =
      (dy >= margin || current.row === 0) && (dy <= WINDOW_TILES - margin || current.row === top);
    if (inX && inY) return current;
  }
  return {
    col: MathUtils.euclideanModulo(Math.round(x - WINDOW_TILES / 2), ULTRA_COLUMNS),
    row: MathUtils.clamp(Math.round(y - WINDOW_TILES / 2), 0, ULTRA_ROWS - WINDOW_TILES),
  };
};

const samePlace = (a: WindowPlace | null, b: WindowPlace | null): boolean =>
  !!a && !!b && a.col === b.col && a.row === b.row;

/** One tile of a window being put together. */
interface Tile {
  /** Position in the window, in tiles (y from the south, like the texture). */
  x: number;
  y: number;
  /** The tile's column and row in the full map (row from the south). */
  col: number;
  row: number;
  /** Decoded, waiting to be copied in. */
  image: DecodedImage | null;
  done: boolean;
}

interface Window extends WindowPlace {
  texture: Texture;
}

interface Build extends Window {
  tiles: Tile[];
  /** Tiles copied in so far. */
  copied: number;
}

interface Entry {
  /** The map the materials were built with (its uniforms are keyed on it). */
  texture: Texture;
  body: BodyId;
  /** Folder of the tiles. */
  url: string;
  uniforms: UltraUniforms;
  /** The object whose own frame the shader works out texture coordinates in. */
  frame: Object3D | null;
  shown: Window | null;
  build: Build | null;
  /** Fading the shown window in (1) or out (0), if it's on its way. */
  fadeTo: 0 | 1 | null;
}

/**
 * Ultra-HD windows for one body at a time (the one flown or zoomed right up to): for each of its
 * maps, a 4096² window of the 16K tiles around the point being looked at. Each new window is put
 * together on the side (tiles still in the old one are copied across on the GPU, the rest
 * downloaded, a tile per frame) and swapped in once it's complete.
 */
export class UltraTextures {
  readonly #entries: Entry[] = [];
  readonly #enabled: boolean;
  readonly #renderer: WebGLRenderer;
  readonly #decoder: ImageDecoder;
  readonly #pool: TexturePool;
  readonly #onChange: () => void;
  readonly #region = new Box2();
  readonly #position = new Vector2();
  readonly #local = new Vector3();
  readonly #uv = new Vector2();
  #active: BodyId | null = null;
  #disposed = false;

  /**
   * @param enabled Whether this device has the memory to spare.
   * @param onChange Called when a window is swapped in or out, so the scene redraws.
   */
  constructor(
    enabled: boolean,
    renderer: WebGLRenderer,
    decoder: ImageDecoder,
    pool: TexturePool,
    onChange: () => void,
  ) {
    this.#enabled = enabled;
    this.#renderer = renderer;
    this.#decoder = decoder;
    this.#pool = pool;
    this.#onChange = onChange;
  }

  get active(): BodyId | null {
    return this.#active;
  }

  register(texture: Texture, body: BodyId, url: string): void {
    if (!this.#enabled) return;
    this.#entries.push({
      texture,
      body,
      url,
      uniforms: uniformsFor(texture),
      frame: null,
      shown: null,
      build: null,
      fadeTo: null,
    });
  }

  /**
   * Find the object each map is drawn on, whose frame its texture coordinates are in. A map can
   * be sampled by a parent and a child (the Earth's clouds: by the Earth, shifted to follow the
   * cloud layer, and by the cloud layer itself); the child, which draws it unshifted, wins.
   */
  bindFrames(root: Object3D): void {
    const byTexture = new Map(this.#entries.map((entry) => [entry.texture, entry]));
    if (byTexture.size === 0) return;
    root.traverse((object) => {
      const material = (object as Partial<Mesh>).material;
      if (!(material instanceof ShaderMaterial)) return;
      for (const uniform of Object.values(material.uniforms)) {
        const entry = byTexture.get(uniform.value as Texture);
        if (entry) entry.frame = object;
      }
    });
  }

  /**
   * Show `body` in ultra HD around `point` (world space, on or towards its surface), or no body.
   * Releases the previous body's windows.
   */
  update(body: BodyId | null, point: Vector3 | null): void {
    if (!this.#enabled || this.#disposed) return;
    if (body !== this.#active) {
      this.#active = body;
      for (const entry of this.#entries) if (entry.body !== body) this.#release(entry);
    }
    if (!body || !point) {
      for (const entry of this.#entries) this.#release(entry);
      return;
    }
    for (const entry of this.#entries) {
      if (entry.body !== body || !entry.frame) continue;
      // Was fading out: bring it back.
      if (entry.shown && entry.fadeTo === 0) entry.fadeTo = 1;
      const local = entry.frame.worldToLocal(this.#local.copy(point));
      if (local.lengthSq() === 0) continue;
      const target = entry.build ?? entry.shown;
      const place = placeWindow(sphereUv(local, this.#uv), target);
      if (samePlace(place, target)) continue;
      if (samePlace(place, entry.shown)) {
        // Came back to the one showing: drop the one on its way.
        this.#cancelBuild(entry);
        continue;
      }
      this.#startBuild(entry, place);
    }
  }

  /**
   * Once a frame: ease fades, and copy the next tile(s) of a window being built to the GPU.
   * @param seconds Time since the last frame.
   */
  step(seconds: number): void {
    for (const entry of this.#entries) this.#stepFade(entry, seconds);
    let budget = TILES_PER_FRAME;
    for (const entry of this.#entries) {
      const build = entry.build;
      if (!build) continue;
      for (const tile of build.tiles) {
        if (budget === 0) return;
        if (tile.done || !this.#copyTile(entry, build, tile)) continue;
        budget--;
        if (build.copied === build.tiles.length) this.#finish(entry, build);
      }
    }
  }

  dispose(): void {
    this.#disposed = true;
    for (const entry of this.#entries) {
      this.#cancelBuild(entry);
      entry.shown?.texture.dispose();
      entry.shown = null;
      entry.fadeTo = null;
    }
  }

  #startBuild(entry: Entry, place: WindowPlace): void {
    this.#cancelBuild(entry);
    const texture = this.#createTarget(entry);
    const tiles: Tile[] = [];
    for (let y = 0; y < WINDOW_TILES; y++) {
      for (let x = 0; x < WINDOW_TILES; x++) {
        tiles.push({
          x,
          y,
          col: (place.col + x) % ULTRA_COLUMNS,
          row: place.row + y,
          image: null,
          done: false,
        });
      }
    }
    const build: Build = { ...place, texture, tiles, copied: 0 };
    entry.build = build;
    for (const tile of tiles) {
      // Already on the GPU in the window showing: copied across in `step`.
      if (this.#shownPosition(entry, tile)) continue;
      // Files count rows from the top (north); the texture from the bottom.
      const url = `${entry.url}${tile.col}-${ULTRA_ROWS - 1 - tile.row}.webp`;
      this.#decoder.decode(url).then(
        (image) => {
          if (entry.build !== build || this.#disposed) image.close(); // moved on meanwhile
          else tile.image = image;
        },
        () => console.warn(`Failed to load texture: ${url}`),
      );
    }
  }

  /** Where a tile sits in the window showing (in tiles), if it's in it. */
  #shownPosition(entry: Entry, tile: Tile): Vector2 | null {
    const shown = entry.shown;
    if (!shown) return null;
    const x = MathUtils.euclideanModulo(tile.col - shown.col, ULTRA_COLUMNS);
    const y = tile.row - shown.row;
    if (x >= WINDOW_TILES || y < 0 || y >= WINDOW_TILES) return null;
    return this.#position.set(x, y);
  }

  /** Copy a tile into the window being built, if it's ready; returns whether it was. */
  #copyTile(entry: Entry, build: Build, tile: Tile): boolean {
    const shown = this.#shownPosition(entry, tile);
    if (!shown && !tile.image) return false;
    if (build.copied === 0) this.#renderer.initTexture(build.texture); // allocate only, no data
    // The last tile also builds the mipmaps (copyTextureToTexture does it when enabled).
    if (build.copied === build.tiles.length - 1) build.texture.mipmapsAutoUpdate = true;
    const destination = new Vector2(tile.x * ULTRA_TILE, tile.y * ULTRA_TILE);
    if (shown && entry.shown) {
      // GPU to GPU: three copies straight from a texture that's already uploaded.
      this.#region.min.set(shown.x * ULTRA_TILE, shown.y * ULTRA_TILE);
      this.#region.max.set((shown.x + 1) * ULTRA_TILE, (shown.y + 1) * ULTRA_TILE);
      this.#renderer.copyTextureToTexture(
        entry.shown.texture,
        build.texture,
        this.#region,
        destination,
      );
    } else if (tile.image) {
      this.#renderer.copyTextureToTexture(tile.image.source, build.texture, null, destination);
      tile.image.close();
      tile.image = null;
    }
    tile.done = true;
    build.copied++;
    return true;
  }

  #finish(entry: Entry, build: Build): void {
    entry.build = null;
    // A window replacing another shows the same texels where they overlap, so it swaps in
    // as is; the first one fades in over the usual map.
    if (entry.shown) this.#pool.release(entry.shown.texture);
    else {
      entry.uniforms.blend.value.y = 0;
      entry.fadeTo = 1;
    }
    entry.shown = { col: build.col, row: build.row, texture: build.texture };
    entry.uniforms.map.value = build.texture;
    entry.uniforms.rect.value.set(
      build.col / ULTRA_COLUMNS,
      build.row / ULTRA_ROWS,
      WINDOW_TILES / ULTRA_COLUMNS,
      WINDOW_TILES / ULTRA_ROWS,
    );
    this.#onChange();
  }

  /** An empty window texture, sampled the same way as the usual map. */
  #createTarget(entry: Entry): Texture {
    const target = this.#pool.acquire(() => {
      const usual = entry.texture;
      const size = WINDOW_TILES * ULTRA_TILE;
      const texture = new Texture({ width: size, height: size });
      texture.colorSpace = usual.colorSpace;
      texture.anisotropy = usual.anisotropy;
      texture.flipY = false;
      // Allocate GPU storage without uploading anything; the tiles fill it in.
      texture.source.dataReady = false;
      texture.needsUpdate = true;
      return texture;
    });
    // Mipmaps are built once, after the last tile.
    target.mipmapsAutoUpdate = false;
    return target;
  }

  #cancelBuild(entry: Entry): void {
    const build = entry.build;
    if (!build) return;
    entry.build = null;
    for (const tile of build.tiles) tile.image?.close();
    this.#pool.release(build.texture);
  }

  /** No longer needed: stop building, and fade the window out before dropping it. */
  #release(entry: Entry): void {
    this.#cancelBuild(entry);
    if (entry.shown && entry.fadeTo !== 0) entry.fadeTo = 0;
  }

  #stepFade(entry: Entry, seconds: number): void {
    const to = entry.fadeTo;
    if (to === null) return;
    const blend = entry.uniforms.blend.value;
    const step = seconds / ULTRA_FADE_SECONDS;
    blend.y = to === 1 ? Math.min(1, blend.y + step) : Math.max(0, blend.y - step);
    this.#onChange();
    if (blend.y !== to) return;
    entry.fadeTo = null;
    if (to === 0) this.#drop(entry);
  }

  #drop(entry: Entry): void {
    if (!entry.shown) return;
    this.#pool.release(entry.shown.texture);
    entry.shown = null;
    entry.uniforms.map.value = null;
    entry.uniforms.rect.value.set(0, 0, 0, 0);
    entry.uniforms.blend.value.y = 1;
    this.#onChange();
  }
}

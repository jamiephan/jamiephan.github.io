/**
 * Procedural nebulae, baked once into an equirectangular texture that the sky shader adds to
 * the Milky Way. The noise is expensive, so it runs a single time on the GPU (and again only if
 * the WebGL context is lost) rather than every frame.
 *
 * Directions are in the sky's local frame, where +X is the galactic centre and +Y galactic
 * north, so most clouds hug the galactic plane like real star-forming regions do.
 */
import {
  Color,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RepeatWrapping,
  ShaderMaterial,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type WebGLRenderer,
} from "three";
import { NOISE, glsl } from "./shaders/chunks.ts";
import nebulaBakeVert from "./shaders/nebulaBake.vert.glsl?raw";
import nebulaBakeFrag from "./shaders/nebulaBake.frag.glsl?raw";

export interface NebulaSpec {
  /** Galactic longitude and latitude of the centre, in degrees. */
  longitude: number;
  latitude: number;
  /** Rough angular radius, in degrees. */
  radius: number;
  /** Main emission colour and the colour of the secondary gas mixed through it. */
  primary: [number, number, number];
  secondary: [number, number, number];
  /** Peak brightness (linear, HDR). */
  intensity: number;
  /** How much dark dust cuts through the glow (0–1). */
  dust: number;
}

const HYDROGEN_ALPHA: [number, number, number] = [1.0, 0.22, 0.3];
const OXYGEN_III: [number, number, number] = [0.2, 0.8, 0.85];
const REFLECTION_BLUE: [number, number, number] = [0.3, 0.5, 1.0];

export const NEBULAE: readonly NebulaSpec[] = [
  // A bright emission region near the galactic core, with a blue reflection fringe.
  {
    longitude: 9,
    latitude: -4,
    radius: 6,
    primary: HYDROGEN_ALPHA,
    secondary: REFLECTION_BLUE,
    intensity: 0.3,
    dust: 0.6,
  },
  // Broad, faint hydrogen clouds along the plane.
  {
    longitude: -24,
    latitude: 7,
    radius: 15,
    primary: [0.95, 0.2, 0.18],
    secondary: [1.0, 0.45, 0.3],
    intensity: 0.1,
    dust: 0.5,
  },
  {
    longitude: 40,
    latitude: -12,
    radius: 8,
    primary: REFLECTION_BLUE,
    secondary: [0.6, 0.75, 1.0],
    intensity: 0.15,
    dust: 0.3,
  },
  {
    longitude: 148,
    latitude: 4,
    radius: 11,
    primary: OXYGEN_III,
    secondary: HYDROGEN_ALPHA,
    intensity: 0.16,
    dust: 0.4,
  },
  {
    longitude: -118,
    latitude: -6,
    radius: 13,
    primary: HYDROGEN_ALPHA,
    secondary: [0.45, 0.3, 1.0],
    intensity: 0.15,
    dust: 0.5,
  },
  {
    longitude: 82,
    latitude: 18,
    radius: 9,
    primary: [0.6, 0.35, 1.0],
    secondary: REFLECTION_BLUE,
    intensity: 0.12,
    dust: 0.3,
  },
  {
    longitude: -68,
    latitude: -24,
    radius: 8,
    primary: [1.0, 0.5, 0.32],
    secondary: HYDROGEN_ALPHA,
    intensity: 0.1,
    dust: 0.4,
  },
];

/** Values are stored square-rooted in 8 bits (less banding in the dark); this is full scale. */
export const NEBULA_RANGE = 0.6;

/** Unit vector for a galactic longitude/latitude, matching the sky shader's equirect mapping. */
export const galacticDirection = (longitude: number, latitude: number): Vector3 => {
  const lon = (longitude * Math.PI) / 180;
  const lat = (latitude * Math.PI) / 180;
  return new Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
};

const createBakeMaterial = (nebulae: readonly NebulaSpec[]): ShaderMaterial =>
  new ShaderMaterial({
    defines: { NEBULA_COUNT: nebulae.length },
    uniforms: {
      uCentres: {
        value: nebulae.map(({ longitude, latitude, radius }) => {
          const { x, y, z } = galacticDirection(longitude, latitude);
          return new Vector4(x, y, z, (radius * Math.PI) / 180);
        }),
      },
      uPrimary: { value: nebulae.map(({ primary }) => new Color(...primary)) },
      uSecondary: { value: nebulae.map(({ secondary }) => new Color(...secondary)) },
      uParams: {
        value: nebulae.map(({ intensity, dust }, i) => new Vector4(intensity, dust, i * 17.31, 0)),
      },
      uRange: { value: NEBULA_RANGE },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: nebulaBakeVert,
    fragmentShader: glsl(NOISE, nebulaBakeFrag),
  });

/**
 * The nebulae, baked into a render target over a few frames (see `bake`). The texture uses the
 * same equirect mapping as the Milky Way (u = longitude, v = latitude).
 */
export class NebulaTexture {
  readonly #target: WebGLRenderTarget;
  /** The heavy noise runs 64 rows a frame: 16 frames for the full 2048 × 1024 texture. */
  readonly bake: ProgressiveBake;

  constructor(nebulae: readonly NebulaSpec[] = NEBULAE, width = 2048) {
    this.#target = new WebGLRenderTarget(width, width / 2, {
      depthBuffer: false,
      generateMipmaps: false,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      wrapS: RepeatWrapping,
    });
    this.bake = new ProgressiveBake(this.#target, () => createBakeMaterial(nebulae), 64);
  }

  get texture() {
    return this.#target.texture;
  }

  dispose(): void {
    this.bake.dispose();
    this.#target.dispose();
  }
}

/**
 * Renders a full-screen shader into a render target a strip of rows at a time, so an expensive
 * bake is spread over several frames instead of stalling one (or tripping the GPU watchdog on
 * weak devices). Call `step()` once per frame until `done`; `restart()` after a context loss.
 */
export class ProgressiveBake {
  readonly #target: WebGLRenderTarget;
  readonly #createMaterial: () => ShaderMaterial;
  readonly #rowsPerStep: number;
  readonly #camera = new OrthographicCamera();
  #quad: Mesh<PlaneGeometry, ShaderMaterial> | null = null;
  /** Whether the quad's shader has finished compiling (see `prepare`). */
  #compiled = false;
  #row = 0;

  constructor(
    target: WebGLRenderTarget,
    createMaterial: () => ShaderMaterial,
    rowsPerStep: number,
  ) {
    this.#target = target;
    this.#createMaterial = createMaterial;
    this.#rowsPerStep = rowsPerStep;
  }

  get done(): boolean {
    return this.#row >= this.#target.height;
  }

  /**
   * Start compiling the bake shader without waiting for it. The noise shaders are heavy (seconds
   * to compile on some drivers), and compiling on first draw would block the page meanwhile.
   * Safe to call every frame.
   */
  prepare(renderer: WebGLRenderer): void {
    if (this.done || this.#quad) return;
    const quad = Object.assign(new Mesh(new PlaneGeometry(2, 2), this.#createMaterial()), {
      frustumCulled: false,
    });
    this.#quad = quad;
    // Compile for the render target the bake draws into.
    const previousTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.#target);
    const compiled = renderer.compileAsync(quad, this.#camera);
    renderer.setRenderTarget(previousTarget);
    void compiled.then(() => {
      if (this.#quad === quad) this.#compiled = true;
    });
  }

  /** Bake the next strip of rows, once the shader is ready (otherwise does nothing yet). */
  step(renderer: WebGLRenderer): void {
    if (this.done) return;
    this.prepare(renderer);
    if (!this.#compiled || !this.#quad) return;

    const target = this.#target;
    const rows = Math.min(this.#rowsPerStep, target.height - this.#row);
    // The viewport stays full size (so UVs cover the whole texture); the scissor picks the strip.
    target.scissor.set(0, this.#row, target.width, rows);
    target.scissorTest = true;

    const previousTarget = renderer.getRenderTarget();
    const xrEnabled = renderer.xr.enabled;
    renderer.xr.enabled = false;
    renderer.setRenderTarget(target);
    renderer.render(this.#quad, this.#camera);
    renderer.setRenderTarget(previousTarget);
    renderer.xr.enabled = xrEnabled;

    target.scissorTest = false;
    this.#row += rows;
    if (this.done) this.#release();
  }

  /** Start again from the first row (the texture's contents were lost). */
  restart(): void {
    this.#row = 0;
  }

  dispose(): void {
    this.#release();
  }

  #release(): void {
    if (!this.#quad) return;
    this.#quad.geometry.dispose();
    this.#quad.material.dispose();
    this.#quad = null;
    this.#compiled = false;
  }
}

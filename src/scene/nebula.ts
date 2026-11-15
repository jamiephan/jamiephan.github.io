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

/** Value noise and 6-octave fBm in [0, 1]. */
export const NOISE = /* glsl */ `
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x),
          mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
          mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }

  float fbm(vec3 p) {
    float sum = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 6; i++) {
      sum += amplitude * noise(p);
      p = p * 2.03 + vec3(1.7, 9.2, 3.1);
      amplitude *= 0.5;
    }
    return sum / 0.984;
  }
`;

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
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      #define PI 3.141592653589793
      varying vec2 vUv;
      uniform vec4 uCentres[NEBULA_COUNT];
      uniform vec3 uPrimary[NEBULA_COUNT];
      uniform vec3 uSecondary[NEBULA_COUNT];
      uniform vec4 uParams[NEBULA_COUNT];
      uniform float uRange;

      ${NOISE}

      void main() {
        float lon = (vUv.x - 0.5) * 2.0 * PI;
        float lat = (vUv.y - 0.5) * PI;
        vec3 dir = vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));

        vec3 light = vec3(0.0);
        for (int i = 0; i < NEBULA_COUNT; i++) {
          vec4 centre = uCentres[i];
          // (angle / radius)² for small angles; skip pixels well outside the cloud.
          float reach = (1.0 - dot(dir, centre.xyz)) / (0.5 * centre.w * centre.w);
          if (reach > 12.0) continue;

          vec4 params = uParams[i];
          // Scale the noise to the cloud so small and large ones have similar structure.
          vec3 p = dir * (2.2 / centre.w) + params.z;
          vec3 warp = vec3(fbm(p), fbm(p + vec3(5.2, 1.3, 2.8)), fbm(p + vec3(9.7, 4.1, 7.3)));
          float n = fbm(p + 1.6 * warp);

          // Ragged edges: denser gas reaches further from the centre.
          float envelope = exp(-reach * mix(1.4, 0.35, n));
          // Billowy body plus thin bright filaments where the warped noise folds over.
          float ridge = 1.0 - abs(2.0 * fbm(p * 1.9 + 2.0 * warp) - 1.0);
          float density = envelope * (smoothstep(0.3, 0.85, n) + 0.5 * pow(ridge, 8.0));

          vec3 colour = mix(uPrimary[i], uSecondary[i], smoothstep(0.4, 0.75, fbm(p * 0.8 + 3.3)));
          // Dense cores glow whiter.
          colour = mix(colour, vec3(1.0, 0.92, 0.9), 0.35 * smoothstep(0.5, 1.2, density));
          // Dark dust lanes cutting across the glow.
          float lanes = smoothstep(0.5, 0.72, fbm(p * 2.4 + warp.yzx * 1.3)) * params.y;

          light += colour * density * (1.0 - lanes) * params.x;
        }

        gl_FragColor = vec4(sqrt(clamp(light / uRange, 0.0, 1.0)), 1.0);
      }
    `,
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

  /** Bake the next strip of rows. */
  step(renderer: WebGLRenderer): void {
    if (this.done) return;
    this.#quad ??= Object.assign(new Mesh(new PlaneGeometry(2, 2), this.#createMaterial()), {
      frustumCulled: false,
    });

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
  }
}

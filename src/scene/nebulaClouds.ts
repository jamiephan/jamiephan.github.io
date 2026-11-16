/**
 * Nebulae you can fly into: clouds of large, soft, camera-facing "puffs" placed in the world
 * (not painted on the sky), so they show parallax and the camera can pass right through them.
 *
 * The puff shapes are baked once into a small texture atlas; each frame only samples it. The
 * gas slowly churns, and now and then a flash ripples through a clump like distant lightning.
 * Puffs fade out as the camera gets close, so flying through one feels like entering a haze
 * rather than hitting a flat card.
 */
import {
  AdditiveBlending,
  Color,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  WebGLRenderTarget,
} from "three";

import { ProgressiveBake } from "./nebula.ts";
import { NOISE, glsl } from "./shaders/chunks.ts";
import nebulaPuffBakeVert from "./shaders/nebulaPuffBake.vert.glsl?raw";
import nebulaPuffBakeFrag from "./shaders/nebulaPuffBake.frag.glsl?raw";
import nebulaPuffVert from "./shaders/nebulaPuff.vert.glsl?raw";
import nebulaPuffFrag from "./shaders/nebulaPuff.frag.glsl?raw";
import { mulberry32 } from "./stars.ts";

type RGB = [number, number, number];

export interface NebulaCloudSpec {
  /** Centre in the solar system's frame (world units; the Earth is 8 across). */
  centre: [number, number, number];
  /** Rough radius of the whole cloud. */
  size: number;
  primary: RGB;
  secondary: RGB;
  /** Colour of the lightning-like flashes. */
  flash: RGB;
  puffs: number;
  clumps: number;
  /** Per-puff brightness (puffs overlap, so this adds up). */
  intensity: number;
  seed: number;
}

/**
 * Real nebulae dwarf a solar system, so these are vast (the Earth is 8 units across) and sit
 * well beyond the planets, but still within flight range. The first hangs above and behind the
 * Earth in the default view; the rest surround the solar system, waiting to be flown to. The
 * last is the biggest and nearest: a sprawling star-forming cloud (glowing hydrogen red, with
 * teal oxygen at its heart, like the Orion Nebula) out by Uranus and Neptune, whose haze
 * reaches the outer planets themselves.
 */
export const NEBULA_CLOUDS: readonly NebulaCloudSpec[] = [
  {
    centre: [-700, 1500, 650],
    size: 520,
    primary: [1.0, 0.24, 0.36],
    secondary: [0.32, 0.5, 1.0],
    flash: [0.75, 0.85, 1.0],
    puffs: 150,
    clumps: 7,
    intensity: 0.034,
    seed: 11,
  },
  {
    centre: [1900, -600, -700],
    size: 600,
    primary: [0.18, 0.78, 0.82],
    secondary: [1.0, 0.32, 0.48],
    flash: [0.85, 1.0, 0.95],
    puffs: 150,
    clumps: 7,
    intensity: 0.032,
    seed: 23,
  },
  {
    centre: [-1700, -1100, -400],
    size: 550,
    primary: [0.62, 0.34, 1.0],
    secondary: [1.0, 0.55, 0.3],
    flash: [1.0, 0.85, 1.0],
    puffs: 140,
    clumps: 6,
    intensity: 0.032,
    seed: 37,
  },
  {
    centre: [1100, 1400, -800],
    size: 450,
    primary: [0.3, 0.5, 1.0],
    secondary: [0.95, 0.35, 0.6],
    flash: [0.8, 0.9, 1.0],
    puffs: 130,
    clumps: 6,
    intensity: 0.03,
    seed: 41,
  },
  {
    centre: [-300, -1900, 800],
    size: 500,
    primary: [1.0, 0.3, 0.22],
    secondary: [1.0, 0.7, 0.35],
    flash: [1.0, 0.9, 0.8],
    puffs: 140,
    clumps: 6,
    intensity: 0.032,
    seed: 53,
  },
  {
    centre: [300, 500, -1650],
    size: 420,
    primary: [0.25, 0.9, 0.6],
    secondary: [1.0, 0.25, 0.4],
    flash: [0.85, 1.0, 0.9],
    puffs: 120,
    clumps: 5,
    intensity: 0.032,
    seed: 67,
  },
  {
    centre: [-1050, 520, -400],
    size: 700,
    primary: [1.0, 0.26, 0.38],
    secondary: [0.28, 0.78, 0.9],
    flash: [0.8, 0.95, 1.0],
    puffs: 300,
    clumps: 11,
    intensity: 0.024,
    seed: 79,
  },
  // High above the solar system: a gold-and-teal pillar-studded cloud (like the Eagle Nebula)
  // nearly overhead, and a smaller magenta one off to the side.
  {
    centre: [200, 300, 1700],
    size: 560,
    primary: [1.0, 0.62, 0.28],
    secondary: [0.2, 0.78, 0.75],
    flash: [1.0, 0.95, 0.8],
    puffs: 170,
    clumps: 8,
    intensity: 0.03,
    seed: 83,
  },
  {
    centre: [-900, -200, 1500],
    size: 460,
    primary: [0.95, 0.3, 0.75],
    secondary: [0.35, 0.45, 1.0],
    flash: [0.95, 0.85, 1.0],
    puffs: 130,
    clumps: 6,
    intensity: 0.032,
    seed: 89,
  },
  // Far below: blue starlight reflecting off dust, with red hydrogen at its edges.
  {
    centre: [-500, -350, -1750],
    size: 520,
    primary: [0.3, 0.5, 1.0],
    secondary: [1.0, 0.3, 0.4],
    flash: [0.85, 0.9, 1.0],
    puffs: 150,
    clumps: 7,
    intensity: 0.03,
    seed: 97,
  },
];

export interface NebulaPuffs {
  /** xyz centre, radius. */
  shapes: Float32Array;
  /** Linear RGB, already scaled by brightness. */
  colors: Float32Array;
  /** Rotation, spin speed (rad/s), atlas tile (0–3), flash delay (seconds). */
  motion: Float32Array;
  /** Flash period (seconds) and phase (0–1) of the clump each puff belongs to. */
  flashes: Float32Array;
}

/** Box–Muller: a standard normal sample. */
const gaussian = (random: () => number): number =>
  Math.sqrt(-2 * Math.log(Math.max(random(), 1e-9))) * Math.cos(2 * Math.PI * random());

/** Puffs for one cloud, clustered into a few clumps with a colour gradient across it. */
export const generateNebulaPuffs = (spec: NebulaCloudSpec): NebulaPuffs => {
  const random = mulberry32(spec.seed);
  const { size, puffs } = spec;
  const centre = new Vector3(...spec.centre);

  const clumps = Array.from({ length: spec.clumps }, () => ({
    centre: new Vector3(gaussian(random), gaussian(random) * 0.6, gaussian(random))
      .multiplyScalar(size * 0.35)
      .add(centre),
    radius: size * (0.3 + 0.25 * random()),
    period: 7 + 9 * random(),
    phase: random(),
  }));
  // The colour shifts from primary to secondary across the cloud along this axis.
  const axis = new Vector3(gaussian(random), gaussian(random), gaussian(random)).normalize();
  const primary = new Color(...spec.primary);
  const secondary = new Color(...spec.secondary);
  const colour = new Color();
  const offset = new Vector3();

  const shapes = new Float32Array(puffs * 4);
  const colors = new Float32Array(puffs * 3);
  const motion = new Float32Array(puffs * 4);
  const flashes = new Float32Array(puffs * 2);
  for (let i = 0; i < puffs; i++) {
    const clump = clumps[Math.floor(random() * clumps.length)]!;
    offset
      .set(gaussian(random), gaussian(random), gaussian(random))
      .multiplyScalar(clump.radius * 0.45);
    const p = offset.clone().add(clump.centre);
    const spread = offset.length() / clump.radius;

    shapes.set([p.x, p.y, p.z, size * (0.16 + 0.22 * random()) * (1 + 0.4 * spread)], i * 4);

    const across = p.clone().sub(centre).dot(axis) / size;
    const t = Math.min(1, Math.max(0, 0.5 + 0.8 * across + 0.25 * gaussian(random)));
    colour.copy(primary).lerp(secondary, t);
    // Dense clump cores are brighter and a little whiter.
    const core = Math.exp(-spread * spread * 1.5);
    colour.lerp(new Color(1, 0.94, 0.92), 0.25 * core);
    const brightness = spec.intensity * (0.5 + 0.5 * random()) * (0.45 + 0.9 * core);
    colors.set([colour.r * brightness, colour.g * brightness, colour.b * brightness], i * 3);

    motion.set(
      [
        random() * Math.PI * 2,
        (random() - 0.5) * 0.05,
        Math.floor(random() * 4),
        // Flashes spread outwards from the clump's core.
        spread * 0.35,
      ],
      i * 4,
    );
    flashes.set([clump.period, clump.phase], i * 2);
  }
  return { shapes, colors, motion, flashes };
};

/** Soft, ragged puff shapes in a 2×2 atlas. */
const createPuffBakeMaterial = (): ShaderMaterial =>
  new ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    vertexShader: nebulaPuffBakeVert,
    fragmentShader: glsl(NOISE, nebulaPuffBakeFrag),
  });

const createPuffMaterial = (atlas: WebGLRenderTarget, time: { value: number }): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: {
      uAtlas: { value: atlas.texture },
      uTime: time,
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: nebulaPuffVert,
    fragmentShader: nebulaPuffFrag,
  });

export interface NebulaCloudTarget {
  centre: Vector3;
  radius: number;
}

/** All the fly-through nebulae: one draw call, plus a tiny baked atlas. */
export class NebulaClouds {
  readonly group = new Group();
  readonly #atlas = new WebGLRenderTarget(1024, 1024, {
    depthBuffer: false,
    generateMipmaps: true,
    minFilter: LinearMipmapLinearFilter,
    magFilter: LinearFilter,
  });
  readonly #time = { value: 0 };
  readonly #mesh: Mesh;
  /** The puff atlas is cheap: 256 rows a frame, done in 4 frames. */
  readonly bake = new ProgressiveBake(this.#atlas, createPuffBakeMaterial, 256);
  /** Each cloud's centre and size, in the group's (solar system's) frame. */
  readonly clouds: NebulaCloudTarget[];

  constructor(specs: readonly NebulaCloudSpec[] = NEBULA_CLOUDS) {
    this.clouds = specs.map(({ centre, size }) => ({
      centre: new Vector3(...centre),
      radius: size,
    }));

    const all = specs.map((spec) => ({ spec, puffs: generateNebulaPuffs(spec) }));
    const count = specs.reduce((sum, spec) => sum + spec.puffs, 0);
    const shapes = new Float32Array(count * 4);
    const colors = new Float32Array(count * 3);
    const motion = new Float32Array(count * 4);
    const flashes = new Float32Array(count * 2);
    const flashColors = new Float32Array(count * 3);
    let offset = 0;
    for (const { spec, puffs } of all) {
      shapes.set(puffs.shapes, offset * 4);
      colors.set(puffs.colors, offset * 3);
      motion.set(puffs.motion, offset * 4);
      flashes.set(puffs.flashes, offset * 2);
      for (let i = 0; i < spec.puffs; i++) flashColors.set(spec.flash, (offset + i) * 3);
      offset += spec.puffs;
    }

    const quad = new PlaneGeometry(2, 2);
    const geometry = new InstancedBufferGeometry();
    geometry.index = quad.index;
    geometry.setAttribute("position", quad.getAttribute("position"));
    geometry.setAttribute("aShape", new InstancedBufferAttribute(shapes, 4));
    geometry.setAttribute("aColor", new InstancedBufferAttribute(colors, 3));
    geometry.setAttribute("aMotion", new InstancedBufferAttribute(motion, 4));
    geometry.setAttribute("aFlash", new InstancedBufferAttribute(flashes, 2));
    geometry.setAttribute("aFlashColor", new InstancedBufferAttribute(flashColors, 3));
    geometry.instanceCount = count;

    this.#mesh = new Mesh(geometry, createPuffMaterial(this.#atlas, this.#time));
    // Billboards are expanded in the shader, so the geometry's bounds mean nothing.
    this.#mesh.frustumCulled = false;
    this.group.add(this.#mesh);
  }

  update(delta: number): void {
    this.#time.value += delta;
  }

  dispose(): void {
    this.bake.dispose();
    this.#atlas.dispose();
  }
}

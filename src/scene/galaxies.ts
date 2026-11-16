/**
 * Distant galaxies on the backdrop: procedural spirals (and a couple of ellipticals) drawn on
 * quads far out on the sky. They're infinitely far away, so the group follows the camera and
 * only turns with the backdrop; like the sky, they sit on the far plane and everything covers them.
 *
 * Each spiral has a warm, old-star core, bluer arms traced along logarithmic spirals, pink
 * knots where stars are forming, and dark dust lanes hugging the inner edge of each arm. Around
 * them, the other shapes real galaxies come in: barred and flocculent spirals, edge-on discs with
 * dust lanes, a Sombrero-like bulge, ring galaxies, lenticulars, ellipticals, an irregular, and
 * a spiral with a small companion at the tip of an arm.
 *
 * The quads face the camera; the shader tilts and turns each disc itself, so a bulge can stand
 * out of an edge-on disc instead of being squashed flat with it.
 */
import {
  AdditiveBlending,
  Color,
  Group,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from "three";

import { NOISE, glsl } from "./shaders/chunks.ts";
import galaxyVert from "./shaders/galaxy.vert.glsl?raw";
import galaxyFrag from "./shaders/galaxy.frag.glsl?raw";

type RGB = [number, number, number];

export interface GalaxySpec {
  /** Direction on the sky, in the solar system's frame (normalised for you). */
  direction: [number, number, number];
  /** Angular radius, in degrees. */
  size: number;
  /** Tilt away from face-on (degrees; 0 = face-on, 80 = nearly edge-on). */
  inclination: number;
  /** Rotation of the disc on the sky (degrees). */
  angle: number;
  /** Spiral arms (0 = elliptical: a smooth glow with no disc structure). */
  arms: number;
  /** How tightly wound the arms are (higher = tighter). */
  winding: number;
  /** Length of a central bar (0 = none), as a fraction of the radius. */
  bar: number;
  /** 0 = long, continuous arms (grand design), 1 = short, patchy fragments (flocculent). */
  flocculent?: number;
  /** Radius of a ring of young stars (fraction of the radius; omit for none). */
  ring?: number;
  /** Patchy, structureless star clouds (like the Magellanic Clouds) instead of arms. */
  irregular?: boolean;
  /** Radius of a large round bulge (fraction of the radius; omit for none), as in the Sombrero. */
  spheroid?: number;
  /** Opacity of the dust lane seen along a disc that's close to edge-on (omit for none). */
  dustLane?: number;
  core: RGB;
  disc: RGB;
  /** Overall brightness (HDR). */
  brightness: number;
  seed: number;
}

const WARM_CORE: RGB = [1.0, 0.82, 0.58];
const BLUE_DISC: RGB = [0.55, 0.7, 1.0];

/**
 * One majestic face-on spiral in the default view (above and right of the Earth), and smaller,
 * fainter ones scattered round the sky at all sorts of tilts.
 */
export const GALAXIES: readonly GalaxySpec[] = [
  {
    direction: [0.22, 1, 0.42],
    size: 7,
    inclination: 32,
    angle: 25,
    arms: 2,
    winding: 2.2,
    bar: 0.18,
    core: WARM_CORE,
    disc: BLUE_DISC,
    brightness: 0.55,
    seed: 3,
  },
  {
    direction: [-0.9, 0.6, -0.35],
    size: 3.2,
    inclination: 68,
    angle: -40,
    arms: 2,
    winding: 2.8,
    bar: 0,
    core: WARM_CORE,
    disc: [0.6, 0.72, 1.0],
    brightness: 0.45,
    seed: 7,
  },
  {
    direction: [0.8, -0.5, 0.6],
    size: 4,
    inclination: 20,
    angle: 70,
    arms: 3,
    winding: 1.8,
    bar: 0,
    core: [1.0, 0.85, 0.65],
    disc: [0.5, 0.68, 1.0],
    brightness: 0.4,
    seed: 11,
  },
  {
    direction: [-0.3, -1, -0.5],
    size: 3.5,
    inclination: 45,
    angle: 10,
    arms: 2,
    winding: 2.4,
    bar: 0.3,
    core: WARM_CORE,
    disc: BLUE_DISC,
    brightness: 0.42,
    seed: 17,
  },
  {
    direction: [1, 0.3, -0.7],
    size: 2.2,
    inclination: 82,
    angle: 120,
    arms: 2,
    winding: 3,
    bar: 0,
    core: WARM_CORE,
    disc: [0.62, 0.74, 1.0],
    brightness: 0.4,
    seed: 23,
  },
  {
    direction: [-0.6, 0.2, 0.9],
    size: 2.6,
    inclination: 55,
    angle: -70,
    arms: 0,
    winding: 0,
    bar: 0,
    core: [1.0, 0.8, 0.6],
    disc: [1.0, 0.85, 0.7],
    brightness: 0.3,
    seed: 29,
  },
  {
    direction: [0.1, 0.4, -1],
    size: 1.8,
    inclination: 30,
    angle: 0,
    arms: 4,
    winding: 1.6,
    bar: 0,
    core: WARM_CORE,
    disc: BLUE_DISC,
    brightness: 0.35,
    seed: 31,
  },
  {
    direction: [-1, -0.4, 0.15],
    size: 1.5,
    inclination: 40,
    angle: 45,
    arms: 0,
    winding: 0,
    bar: 0,
    core: [1.0, 0.78, 0.55],
    disc: [1.0, 0.82, 0.65],
    brightness: 0.25,
    seed: 37,
  },
  // Grand-design spiral, nearly face-on, with a small companion at the tip of one arm
  // (like the Whirlpool, M51).
  {
    direction: [-0.35, 0.85, 0.75],
    size: 4.2,
    inclination: 18,
    angle: 60,
    arms: 2,
    winding: 2,
    bar: 0,
    core: WARM_CORE,
    disc: [0.5, 0.7, 1.0],
    brightness: 0.45,
    seed: 41,
  },
  {
    direction: [-0.27, 0.86, 0.69],
    size: 1.2,
    inclination: 30,
    angle: 20,
    arms: 0,
    winding: 0,
    bar: 0,
    core: [1.0, 0.8, 0.6],
    disc: [1.0, 0.84, 0.68],
    brightness: 0.35,
    seed: 43,
  },
  // Strongly barred spiral, its arms sweeping out from the ends of the bar (like NGC 1300).
  {
    direction: [0.55, 0.15, 0.9],
    size: 3.6,
    inclination: 38,
    angle: 100,
    arms: 2,
    winding: 1.4,
    bar: 0.5,
    core: WARM_CORE,
    disc: [0.55, 0.72, 1.0],
    brightness: 0.42,
    seed: 47,
  },
  // Nearly edge-on, with a huge bright bulge cut by a dark dust lane (like the Sombrero, M104).
  {
    direction: [0.95, -0.15, 0.1],
    size: 2.8,
    inclination: 84,
    angle: -12,
    arms: 2,
    winding: 4,
    bar: 0,
    core: [1.0, 0.85, 0.66],
    disc: [0.9, 0.85, 0.8],
    brightness: 0.45,
    seed: 53,
    spheroid: 0.5,
    dustLane: 0.85,
  },
  // A thin spiral seen exactly edge-on: a needle of light split by its dust lane (NGC 891).
  {
    direction: [-0.75, -0.55, -0.6],
    size: 3.4,
    inclination: 89,
    angle: 30,
    arms: 2,
    winding: 2.4,
    bar: 0,
    core: WARM_CORE,
    disc: [0.62, 0.74, 1.0],
    brightness: 0.55,
    seed: 59,
    spheroid: 0.12,
    dustLane: 0.9,
  },
  // Flocculent spiral: many short, patchy arm fragments instead of two clean arms (NGC 2841).
  {
    direction: [0.35, -0.95, 0.25],
    size: 2.8,
    inclination: 50,
    angle: -25,
    arms: 5,
    winding: 2.6,
    bar: 0,
    core: [1.0, 0.84, 0.62],
    disc: [0.6, 0.74, 1.0],
    brightness: 0.4,
    seed: 61,
    flocculent: 0.8,
  },
  // Large, loosely wound, lopsided spiral with ragged arms (like the Pinwheel, M101).
  {
    direction: [0.6, 0.65, -0.3],
    size: 3.8,
    inclination: 12,
    angle: 150,
    arms: 3,
    winding: 1.5,
    bar: 0,
    core: [1.0, 0.86, 0.68],
    disc: [0.5, 0.68, 1.0],
    brightness: 0.4,
    seed: 67,
    flocculent: 0.35,
  },
  // Ring galaxy: a round core and a detached ring of blue stars (like Hoag's Object).
  {
    direction: [-0.45, -0.3, 1],
    size: 1.7,
    inclination: 10,
    angle: 0,
    arms: 0,
    winding: 0,
    bar: 0,
    core: [1.0, 0.8, 0.58],
    disc: [0.5, 0.72, 1.0],
    brightness: 0.4,
    seed: 71,
    ring: 0.62,
  },
  // Collisional ring, tilted, studded with star-forming knots (like the Cartwheel).
  {
    direction: [0.2, 0.75, -0.8],
    size: 2,
    inclination: 45,
    angle: 35,
    arms: 0,
    winding: 0,
    bar: 0,
    core: [1.0, 0.82, 0.62],
    disc: [0.55, 0.72, 1.0],
    brightness: 0.4,
    seed: 73,
    ring: 0.8,
  },
  // Irregular: patchy star clouds round an off-centre bar (like the Large Magellanic Cloud).
  {
    direction: [-0.85, 0.15, -0.9],
    size: 3,
    inclination: 30,
    angle: -20,
    arms: 0,
    winding: 0,
    bar: 0.4,
    core: [1.0, 0.86, 0.7],
    disc: [0.62, 0.76, 1.0],
    brightness: 0.4,
    seed: 79,
    irregular: true,
  },
  // Lenticular: a bulge and a smooth disc with no arms, seen at a slant (an S0, like NGC 5866).
  {
    direction: [0.05, -0.6, -0.95],
    size: 2,
    inclination: 65,
    angle: 75,
    arms: 0,
    winding: 0,
    bar: 0,
    core: [1.0, 0.82, 0.6],
    disc: [1.0, 0.86, 0.72],
    brightness: 0.32,
    seed: 83,
    spheroid: 0.3,
  },
];

/**
 * The Milky Way, then the galaxies on it, are drawn after every other opaque object. Both sit on
 * the far plane, so the depth test skips them wherever a planet or moon is in front: a body
 * filling the view no longer costs a full-screen sky pass underneath it. (Transparent objects,
 * stars included, are drawn after all opaque ones regardless, so they still land on the sky.)
 */
export const BACKDROP_RENDER_ORDER = 100;

/** Distance of the quads from the camera: inside the far plane, beyond everything nearby. */
const SKY_DISTANCE = 1200;

const createGalaxyMaterial = (spec: GalaxySpec): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: {
      uCore: { value: new Color(...spec.core) },
      uDisc: { value: new Color(...spec.disc) },
      uArms: { value: spec.arms },
      uWinding: { value: spec.winding },
      uBar: { value: spec.bar },
      uBrightness: { value: spec.brightness },
      uSeed: { value: spec.seed * 7.13 },
      uAngle: { value: (spec.angle * Math.PI) / 180 },
      uCosTilt: { value: Math.cos((spec.inclination * Math.PI) / 180) },
      uFlocculent: { value: spec.flocculent ?? 0 },
      uRing: { value: spec.ring ?? 0 },
      uIrregular: { value: spec.irregular ? 1 : 0 },
      uSpheroid: { value: spec.spheroid ?? 0 },
      uDustLane: { value: spec.dustLane ?? 0 },
    },
    // Like the sky: on the far plane (see the vertex shader), behind everything.
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: galaxyVert,
    fragmentShader: glsl(NOISE, galaxyFrag),
  });

/** All the background galaxies. Keep `group` centred on the camera and turned with the sky. */
export class Galaxies {
  readonly group = new Group();

  constructor(specs: readonly GalaxySpec[] = GALAXIES) {
    const geometry = new PlaneGeometry(2, 2);
    const facing = new Vector3();
    for (const spec of specs) {
      const mesh = new Mesh(geometry, createGalaxyMaterial(spec));
      const direction = new Vector3(...spec.direction).normalize();
      mesh.position.copy(direction).multiplyScalar(SKY_DISTANCE);
      // Face the camera (the group's centre); the shader turns and tilts the disc.
      mesh.lookAt(facing.set(0, 0, 0));
      mesh.scale.setScalar(SKY_DISTANCE * Math.tan((spec.size * Math.PI) / 180));
      // Just after the Milky Way (added onto it).
      mesh.renderOrder = BACKDROP_RENDER_ORDER + 0.1;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
  }
}

/**
 * Distant galaxies on the backdrop: procedural spirals (and a couple of ellipticals) drawn on
 * quads far out on the sky. They're infinitely far away, so the group follows the camera and
 * only turns with the backdrop; like the sky, they're drawn first and everything covers them.
 *
 * Each spiral has a warm, old-star core, bluer arms traced along logarithmic spirals, pink
 * knots where stars are forming, and dark dust lanes hugging the inner edge of each arm.
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
];

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
    },
    // Like the sky: drawn first, behind everything, never hiding anything.
    depthTest: false,
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
      // Face the camera (the group's centre), then turn and tilt the disc on the sky.
      mesh.lookAt(facing.set(0, 0, 0));
      mesh.rotateZ((spec.angle * Math.PI) / 180);
      mesh.rotateX((spec.inclination * Math.PI) / 180);
      mesh.scale.setScalar(SKY_DISTANCE * Math.tan((spec.size * Math.PI) / 180));
      // Just after the Milky Way, before anything in the scene.
      mesh.renderOrder = -1.9;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
  }
}

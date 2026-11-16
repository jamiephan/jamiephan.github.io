/**
 * The backdrop: the Milky Way panorama (with the Sun's disc and the baked nebulae) on a sphere,
 * and the starfield in front of it. Keep `group` centred on the camera: it's infinitely far away.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Matrix4,
  Mesh,
  Points,
  SphereGeometry,
  Vector3,
  type ShaderMaterial,
  type Texture,
} from "three";

import { BACKDROP_RENDER_ORDER } from "./galaxies.ts";
import { createSkyMaterial, createStarMaterial, type LightingUniforms } from "./materials.ts";
import { generateStarfield } from "./stars.ts";

/** The sky sits well beyond the furthest planet (and the camera's far plane covers it). */
const SKY_RADIUS = 1500;
const STAR_RADIUS = 1400;
const STAR_COUNT = 4500;

export interface Sky {
  group: Group;
  /** Stars are sized in device pixels: set `uPixelRatio` when the pixel ratio changes. */
  starMaterial: ShaderMaterial;
}

export const createSky = (
  milkyWay: Texture,
  nebula: { texture: Texture; range: number },
  lighting: LightingUniforms,
): Sky => {
  const group = new Group();

  const skyMesh = new Mesh(
    new SphereGeometry(SKY_RADIUS, 64, 32),
    createSkyMaterial(milkyWay, nebula.texture, nebula.range, lighting),
  );
  skyMesh.renderOrder = BACKDROP_RENDER_ORDER;
  skyMesh.frustumCulled = false;

  const { positions, colors, sizes } = generateStarfield({
    count: STAR_COUNT,
    radius: STAR_RADIUS,
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("aColor", new BufferAttribute(colors, 3));
  geometry.setAttribute("aSize", new BufferAttribute(sizes, 1));
  const starMaterial = createStarMaterial(lighting);
  // A single draw call for the whole starfield.
  const stars = new Points(geometry, starMaterial);
  stars.frustumCulled = false;
  stars.renderOrder = -1;

  // Orient the galaxy so its bright core sits diagonally behind the Earth.
  const galacticCentre = new Vector3(0.25, 1, 0.12).normalize();
  const galacticNorth = new Vector3(0.75, -0.1, 1).projectOnPlane(galacticCentre).normalize();
  group.quaternion.setFromRotationMatrix(
    new Matrix4().makeBasis(
      galacticCentre,
      galacticNorth,
      new Vector3().crossVectors(galacticCentre, galacticNorth),
    ),
  );
  group.add(skyMesh, stars);
  return { group, starMaterial };
};

/**
 * The Earth (surface, clouds, night-side aurorae and storms, ray-marched atmosphere) and the
 * Moon, tidally locked on its tilted orbit. The Earth sits at the origin (see `layout.ts`).
 */
import {
  BackSide,
  Color,
  FrontSide,
  Group,
  MathUtils,
  Mesh,
  SphereGeometry,
  Vector3,
  Vector4,
  type Material,
  type ShaderMaterial,
} from "three";

import earthCloudsUrl from "../assets/textures/earth-clouds.webp";
import earthDayUrl from "../assets/textures/earth-day.webp";
import earthNightUrl from "../assets/textures/earth-night.webp";
import earthNormalUrl from "../assets/textures/earth-normal.webp";
import earthSpecularUrl from "../assets/textures/earth-specular.webp";
import moonUrl from "../assets/textures/moon.webp";
import type { BodyId } from "./bodies.ts";
import { EARTH_RADIUS } from "./layout.ts";
import {
  createAtmosphereMaterial,
  createCloudMaterial,
  createEarthMaterial,
  createEarthNightMaterial,
  createRockyMaterial,
  type LightingUniforms,
} from "./materials.ts";
import { degToRad, perFrameAt60, wrappedOffset } from "./math.ts";
import type { LoadTexture } from "./sceneTextures.ts";
import type { FocusTarget } from "./solarSystem.ts";

/** Real size ratios (see `layout.ts`); distances are compressed. */
const CLOUD_RADIUS = EARTH_RADIUS * 1.006;
/** The aurora / thunderstorm shell sits just above the clouds. */
const NIGHT_SHELL_RADIUS = EARTH_RADIUS * 1.012;
const ATMOSPHERE_RADIUS = EARTH_RADIUS * 1.035;
const EARTH_AXIAL_TILT = degToRad(23.44);
const MOON_RADIUS = EARTH_RADIUS * 0.273;
const MOON_ORBIT_RADIUS = 14;
const MOON_ORBIT_TILT = -0.2;
/** How far from the Earth the camera starts (top of the page), and stops when flying to it. */
export const EARTH_VIEW_DISTANCE = 25;

/** Degrees per second. */
const SPEED = { earth: 4, clouds: 0.35, moonOrbit: 1.5 } as const;

const Y_AXIS = new Vector3(0, 1, 0);
const TAU = 2 * Math.PI;

export interface EarthSystem {
  /** The Earth, tilted on its axis, with its clouds and night-side effects. */
  earth: Group;
  /** Drawn from its inside faces while the camera is within it (see `beforeRender`). */
  atmosphere: Mesh;
  /** Carries the Moon's orbit: turn it with the backdrop so the Moon turns with it too. */
  moonFrame: Group;
  /** The Earth and the Moon, by id. */
  targets: Map<BodyId, FocusTarget>;
  /** Spin the Earth and clouds, and move the Moon along its orbit. */
  update: (seconds: number) => void;
  /**
   * Begin gliding the Earth, clouds and Moon back to where they were at page load, each the
   * shorter way round. Returns a step to call after `update` with eased progress 0–1.
   */
  returnHome: () => (progress: number) => void;
  /** Bring the shaders up to date with this frame's positions and the camera. */
  beforeRender: (cameraPosition: Vector3) => void;
}

export const createEarthSystem = (
  load: LoadTexture,
  lighting: LightingUniforms,
  /** Clock for aurorae and storms, and 1 to allow flashing (storms), 0 with reduced motion. */
  effects: { time: { value: number }; flashes: { value: number } },
): EarthSystem => {
  /** The Moon as a shadow-casting sphere, shared by the Earth and cloud shaders. */
  const moonOccluder = { value: new Vector4(0, 0, 0, MOON_RADIUS) };

  /* ---------- Earth ---------- */
  const textures = {
    day: load(earthDayUrl, { sharp: true, body: "earth" }),
    night: load(earthNightUrl, { sharp: true, body: "earth" }),
    normal: load(earthNormalUrl, { color: false, sharp: true, body: "earth" }),
    specular: load(earthSpecularUrl, { color: false, body: "earth" }),
    clouds: load(earthCloudsUrl, { color: false, sharp: true, body: "earth" }),
  };

  // Tilt the spin axis towards the Sun (northern summer), then spin about local +Y.
  const tilt = new Group();
  tilt.quaternion.setFromUnitVectors(
    Y_AXIS,
    new Vector3(Math.sin(EARTH_AXIAL_TILT), 0, Math.cos(EARTH_AXIAL_TILT)),
  );

  const earthMaterial: ShaderMaterial = createEarthMaterial(textures, lighting, moonOccluder);
  const earth = new Mesh(new SphereGeometry(EARTH_RADIUS, 128, 64), earthMaterial);
  // Start with Europe and Africa facing the camera.
  earth.rotation.y = Math.PI / 2 - 2 * Math.PI * ((15 + 180) / 360);

  const clouds = new Mesh(
    new SphereGeometry(CLOUD_RADIUS, 128, 64),
    createCloudMaterial(textures.clouds, lighting, moonOccluder),
  );
  clouds.renderOrder = 1;
  earth.add(clouds);

  // Aurorae and thunderstorms on the night side, riding with the clouds (and their UVs).
  const nightShell = new Mesh(
    new SphereGeometry(NIGHT_SHELL_RADIUS, 96, 48),
    createEarthNightMaterial(textures.clouds, lighting, effects.time, effects.flashes),
  );
  nightShell.renderOrder = 1.5;
  clouds.add(nightShell);
  tilt.add(earth);

  const atmosphere = new Mesh(
    new SphereGeometry(ATMOSPHERE_RADIUS, 96, 48),
    createAtmosphereMaterial(lighting, EARTH_RADIUS, ATMOSPHERE_RADIUS),
  );
  atmosphere.renderOrder = 2;

  /* ---------- Moon (tidally locked: the same face always points at the Earth) ---------- */
  const moon = new Mesh(
    new SphereGeometry(MOON_RADIUS, 64, 32),
    createRockyMaterial(load(moonUrl, { sharp: true, body: "moon" }), lighting, {
      // The Earth eclipses the Moon, and lights its night side (earthshine).
      occluder: { value: new Vector4(0, 0, 0, EARTH_RADIUS) },
      ambient: new Color(0.015, 0.02, 0.03),
    }),
  );
  moon.position.set(MOON_ORBIT_RADIUS, 0, 0);
  moon.rotation.set(Math.PI / 2, Math.PI, 0);
  const moonPivot = new Group();
  moonPivot.rotation.z = -0.4;
  moonPivot.add(moon);
  const moonOrbit = new Group();
  moonOrbit.rotation.x = MOON_ORBIT_TILT;
  moonOrbit.add(moonPivot);
  const moonFrame = new Group();
  moonFrame.add(moonOrbit);

  /** The turns at page load, for `returnHome`. */
  const home = { earth: earth.rotation.y, clouds: clouds.rotation.y, moon: moonPivot.rotation.z };

  const targets = new Map<BodyId, FocusTarget>([
    [
      "earth",
      {
        radius: EARTH_RADIUS,
        viewDistance: EARTH_VIEW_DISTANCE,
        getPosition: (out) => out.set(0, 0, 0),
      },
    ],
    [
      "moon",
      {
        radius: MOON_RADIUS,
        viewDistance: MOON_RADIUS * 5,
        getPosition: (out) => moon.getWorldPosition(out),
      },
    ],
  ]);

  const spin = (degreesPerSecond: number, seconds: number): number =>
    degToRad(perFrameAt60(degreesPerSecond / 60, seconds));
  const moonPosition = new Vector3();

  return {
    earth: tilt,
    atmosphere,
    moonFrame,
    targets,
    update: (seconds) => {
      earth.rotation.y += spin(SPEED.earth, seconds);
      clouds.rotation.y += spin(SPEED.clouds, seconds);
      moonPivot.rotation.z += spin(SPEED.moonOrbit, seconds);
    },
    returnHome: () => {
      const offsets = {
        earth: wrappedOffset(earth.rotation.y, home.earth, TAU),
        clouds: wrappedOffset(clouds.rotation.y, home.clouds, TAU),
        moon: wrappedOffset(moonPivot.rotation.z, home.moon, TAU),
      };
      return (progress) => {
        const left = 1 - progress;
        earth.rotation.y = home.earth + offsets.earth * left;
        clouds.rotation.y = home.clouds + offsets.clouds * left;
        moonPivot.rotation.z = home.moon + offsets.moon * left;
      };
    },
    beforeRender: (cameraPosition) => {
      moonFrame.updateMatrixWorld(true);
      const { x, y, z } = moon.getWorldPosition(moonPosition);
      moonOccluder.value.set(x, y, z, MOON_RADIUS);

      // Clouds drift relative to the ground; shift the cloud-shadow lookup to match.
      // Kept within 0–1 (the texture repeats), so precision doesn't drain away as it grows.
      earthMaterial.uniforms.uCloudOffset!.value = MathUtils.euclideanModulo(
        -clouds.rotation.y / TAU,
        1,
      );

      // Inside the atmosphere its outer faces point away from the camera; draw the inner ones.
      // (The shader marches from the camera either way, so the result is the same.)
      (atmosphere.material as Material).side =
        cameraPosition.length() < ATMOSPHERE_RADIUS ? BackSide : FrontSide;
    },
  };
};

/**
 * Custom shaders for the space scene.
 *
 * Everything is lit by a single directional "Sun" (`uSunDir`, world space, pointing *towards*
 * the Sun). Shadows between bodies (eclipses, ring shadows) are computed analytically against
 * spheres and planes, so there are no shadow maps or extra render passes.
 */
import {
  AdditiveBlending,
  BackSide,
  DoubleSide,
  Color,
  NormalBlending,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  type Texture,
} from "three";
import { COMMON, DUST_VERTEX, NOISE, RIM, SPHERE_VARYINGS, ULTRA, glsl } from "./shaders/chunks.ts";
import { ultraUniforms } from "./ultraTextures.ts";
import sphereVert from "./shaders/sphere.vert.glsl?raw";
import earthFrag from "./shaders/earth.frag.glsl?raw";
import cloudFrag from "./shaders/cloud.frag.glsl?raw";
import atmosphereVert from "./shaders/atmosphere.vert.glsl?raw";
import atmosphereFrag from "./shaders/atmosphere.frag.glsl?raw";
import rockyFrag from "./shaders/rocky.frag.glsl?raw";
import cloudyPlanetFrag from "./shaders/cloudyPlanet.frag.glsl?raw";
import haloVert from "./shaders/halo.vert.glsl?raw";
import haloFrag from "./shaders/halo.frag.glsl?raw";
import ringVert from "./shaders/ring.vert.glsl?raw";
import ringFrag from "./shaders/ring.frag.glsl?raw";
import skyVert from "./shaders/sky.vert.glsl?raw";
import skyFrag from "./shaders/sky.frag.glsl?raw";
import starVert from "./shaders/star.vert.glsl?raw";
import starFrag from "./shaders/star.frag.glsl?raw";
import asteroidVert from "./shaders/asteroid.vert.glsl?raw";
import asteroidFrag from "./shaders/asteroid.frag.glsl?raw";
import cometTailVert from "./shaders/cometTail.vert.glsl?raw";
import cometTailFrag from "./shaders/cometTail.frag.glsl?raw";
import comaVert from "./shaders/coma.vert.glsl?raw";
import comaFrag from "./shaders/coma.frag.glsl?raw";
import cometDustVert from "./shaders/cometDust.vert.glsl?raw";
import cometDustFrag from "./shaders/cometDust.frag.glsl?raw";
import spaceDustVert from "./shaders/spaceDust.vert.glsl?raw";
import spaceDustFrag from "./shaders/spaceDust.frag.glsl?raw";
import dustStreakVert from "./shaders/dustStreak.vert.glsl?raw";
import dustStreakFrag from "./shaders/dustStreak.frag.glsl?raw";
import earthNightFrag from "./shaders/earthNight.frag.glsl?raw";

/** Shared uniform objects: updating `.value` once updates every material that uses them. */
export interface LightingUniforms {
  uSunDir: { value: Vector3 };
  uSunColor: { value: Color };
}

export const createLightingUniforms = (direction: Vector3, color: Color): LightingUniforms => ({
  uSunDir: { value: direction.clone().normalize() },
  uSunColor: { value: color.clone() },
});

/* ---------------------------------------------------------------------------------------------
 * Earth
 * ------------------------------------------------------------------------------------------- */

export interface EarthTextures {
  day: Texture;
  night: Texture;
  normal: Texture;
  specular: Texture;
  clouds: Texture;
}

export const createEarthMaterial = (
  textures: EarthTextures,
  lighting: LightingUniforms,
  occluder: { value: Vector4 },
): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: {
      ...lighting,
      uDay: { value: textures.day },
      uNight: { value: textures.night },
      uNormal: { value: textures.normal },
      uSpecular: { value: textures.specular },
      uClouds: { value: textures.clouds },
      ...ultraUniforms("uDay", textures.day),
      ...ultraUniforms("uNight", textures.night),
      ...ultraUniforms("uNormal", textures.normal),
      ...ultraUniforms("uSpecular", textures.specular),
      ...ultraUniforms("uClouds", textures.clouds),
      uCloudOffset: { value: 0 },
      uNormalStrength: { value: 1.6 },
      uOccluder: occluder,
    },
    vertexShader: sphereVert,
    fragmentShader: glsl(COMMON, SPHERE_VARYINGS, ULTRA, earthFrag),
  });

export const createCloudMaterial = (
  clouds: Texture,
  lighting: LightingUniforms,
  occluder: { value: Vector4 },
): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: {
      ...lighting,
      uClouds: { value: clouds },
      ...ultraUniforms("uClouds", clouds),
      uOccluder: occluder,
    },
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    vertexShader: sphereVert,
    fragmentShader: glsl(COMMON, SPHERE_VARYINGS, ULTRA, cloudFrag),
  });

/**
 * Single-scattering atmosphere (Rayleigh + Mie), ray-marched per pixel on a shell around the
 * planet. Distances are normalised to the planet radius; densities are tuned so a vertical
 * column has Earth's real optical depth, just over a slightly thicker shell for readability.
 */
export const createAtmosphereMaterial = (
  lighting: LightingUniforms,
  planetRadius: number,
  atmosphereRadius: number,
): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: {
      ...lighting,
      uCenter: { value: new Vector3() },
      uPlanetRadius: { value: planetRadius },
      uAtmosphereRadius: { value: atmosphereRadius / planetRadius },
      uIntensity: { value: 14 },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    // The step count scales with the path length (see the shader): MIN_PRIMARY_STEPS for the
    // short, steep paths over the disc, PRIMARY_STEPS for the long, grazing ones at the limb.
    defines: { PRIMARY_STEPS: 14, MIN_PRIMARY_STEPS: 6, LIGHT_STEPS: 4 },
    vertexShader: atmosphereVert,
    fragmentShader: glsl(COMMON, atmosphereFrag),
  });

/* ---------------------------------------------------------------------------------------------
 * Planets and moons
 * ------------------------------------------------------------------------------------------- */

export interface RockyBodyOptions {
  /** Strength of the bump derived from albedo. */
  bump?: number;
  /** A sphere that can eclipse the Sun (xyz = centre, w = radius). */
  occluder?: { value: Vector4 };
  /** Light reflected from a nearby planet onto the night side. */
  ambient?: Color;
  /** Colour of a thin atmosphere at the limb (black = none). */
  rim?: Color;
}

/** Airless (or nearly airless) rocky bodies: the Moon, Mercury, Mars. */
export const createRockyMaterial = (
  map: Texture,
  lighting: LightingUniforms,
  {
    bump = 7,
    occluder = { value: new Vector4(0, 0, 0, 0) },
    ambient = new Color(0.004, 0.005, 0.007),
    rim = new Color(0, 0, 0),
  }: RockyBodyOptions = {},
): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: {
      ...lighting,
      uMap: { value: map },
      ...ultraUniforms("uMap", map),
      uBump: { value: bump },
      uOccluder: occluder,
      uAmbient: { value: ambient },
      uRim: { value: rim },
    },
    vertexShader: sphereVert,
    fragmentShader: glsl(COMMON, RIM, SPHERE_VARYINGS, ULTRA, rockyFrag),
  });

export interface RingUniforms {
  uRingNormal: { value: Vector3 };
  uRingCenter: { value: Vector3 };
  /** Inner / outer ring radius in world units. */
  uRingRadii: { value: Vector2 };
  uRing: { value: Texture };
}

export const createRingUniforms = (ring: Texture, inner: number, outer: number): RingUniforms => ({
  uRingNormal: { value: new Vector3(0, 1, 0) },
  uRingCenter: { value: new Vector3() },
  uRingRadii: { value: new Vector2(inner, outer) },
  uRing: { value: ring },
});

export interface CloudyPlanetOptions {
  /** Ring system that casts shadows onto the planet. */
  ring?: RingUniforms;
  /** Colour of the haze at the limb (black = none). */
  rim?: Color;
  /** 0 = no limb darkening, 1 = strong. */
  limbDarkening?: number;
  /** Multiplier on the texture colour, for maps too bright to survive tone mapping. */
  albedo?: number;
}

/** Planets whose visible surface is cloud tops: Venus and the giants. */
export const createCloudyPlanetMaterial = (
  map: Texture,
  lighting: LightingUniforms,
  { ring, rim = new Color(0, 0, 0), limbDarkening = 0.35, albedo = 1 }: CloudyPlanetOptions = {},
): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: {
      ...lighting,
      ...ring,
      uMap: { value: map },
      ...ultraUniforms("uMap", map),
      uRim: { value: rim },
      uLimbDarkening: { value: limbDarkening },
      uAlbedo: { value: albedo },
    },
    defines: ring ? { HAS_RING: "" } : {},
    vertexShader: sphereVert,
    fragmentShader: glsl(COMMON, RIM, SPHERE_VARYINGS, ULTRA, cloudyPlanetFrag),
  });

export interface HaloOptions {
  /** Glow colour at the sunlit limb (HDR; keep it low, it's added on top of the sky). */
  color: Color;
  /** Scale height as a fraction of the planet radius: how far the haze reaches. */
  height: number;
}

/** Shell radius for a halo, as a multiple of the planet radius (where the haze has faded). */
export const haloShell = (height: number): number => 1 + 5 * height;

/**
 * Faint atmospheric haze beyond the limb of a planet, computed analytically (no ray march).
 * Draw it on a sphere of `haloShell(height)` × `radius`, parented to the planet.
 */
export const createHaloMaterial = (
  lighting: LightingUniforms,
  radius: number,
  { color, height }: HaloOptions,
): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: {
      ...lighting,
      uColor: { value: color },
      uRadius: { value: radius },
      uHeight: { value: height },
      uShell: { value: haloShell(height) },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: BackSide,
    vertexShader: haloVert,
    fragmentShader: haloFrag,
  });

export const createRingMaterial = (
  lighting: LightingUniforms,
  ring: RingUniforms,
  planet: { value: Vector4 },
): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: { ...lighting, ...ring, uPlanet: planet },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    vertexShader: ringVert,
    fragmentShader: glsl(COMMON, ringFrag),
  });

/* ---------------------------------------------------------------------------------------------
 * Sky
 * ------------------------------------------------------------------------------------------- */

/**
 * Milky Way panorama plus the Sun's disc and glare. Rendered on a sphere that follows the
 * camera; texture lookups use the sphere's local (rotating) direction, the Sun its world one.
 */
export const createSkyMaterial = (
  milkyWay: Texture,
  nebula: Texture,
  nebulaRange: number,
  lighting: LightingUniforms,
): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: {
      ...lighting,
      uMilkyWay: { value: milkyWay },
      uNebula: { value: nebula },
      uNebulaRange: { value: nebulaRange },
      uExposure: { value: 2.6 },
      uSunAngularRadius: { value: 0.012 },
    },
    side: BackSide,
    // Kept on the far plane by the vertex shader, so the depth test leaves out every pixel a
    // body covers (see `BACKDROP_RENDER_ORDER`).
    depthWrite: false,
    vertexShader: skyVert,
    fragmentShader: glsl(COMMON, skyFrag),
  });

export const createStarMaterial = (lighting: LightingUniforms): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: { ...lighting, uPixelRatio: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: starVert,
    fragmentShader: starFrag,
  });

/* ---------------------------------------------------------------------------------------------
 * Asteroids and comets
 * ------------------------------------------------------------------------------------------- */

/** Instanced, flat-shaded rocks lit by the Sun. Per-instance tint comes from `instanceColor`. */
/**
 * Asteroid belt rocks (instanced). They lie along a band (local x), drifting along it by
 * `band.shift` and wrapping round at its ends, where they shrink away to nothing.
 */
export const createAsteroidMaterial = (
  lighting: LightingUniforms,
  time: { value: number },
  band: { shift: { value: number }; length: number },
): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: {
      ...lighting,
      uTime: time,
      uShift: band.shift,
      uHalfLength: { value: band.length / 2 },
    },
    vertexShader: asteroidVert,
    fragmentShader: asteroidFrag,
  });

export interface CometTailOptions {
  color: Color;
  /** World-space length and maximum half-width. */
  length: number;
  width: number;
  /** Peak brightness (HDR). */
  intensity: number;
  /** Fine streamers, as seen in ion tails. */
  streamers: number;
}

/** Shared per-comet uniforms: head position, anti-sun axis and orbital curvature. */
export interface CometUniforms {
  uHead: { value: Vector3 };
  uAxis: { value: Vector3 };
  uCurve: { value: Vector3 };
  uTime: { value: number };
  /** 0–1: how strongly the comet is outgassing (it brightens near perihelion). */
  uActivity: { value: number };
}

/**
 * A comet tail drawn as a camera-facing ribbon that follows a (possibly curved) spine, with
 * soft gaussian falloff across it and fading along it. Additive, so it reads as glowing gas.
 */
export const createCometTailMaterial = (
  comet: CometUniforms,
  { color, length, width, intensity, streamers }: CometTailOptions,
): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: {
      ...comet,
      uColor: { value: color },
      uLength: { value: length },
      uWidth: { value: width },
      uIntensity: { value: intensity },
      uStreamers: { value: streamers },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    vertexShader: cometTailVert,
    fragmentShader: cometTailFrag,
  });

/** Glowing coma around a comet's nucleus: a camera-facing gaussian sprite. */
export const createComaMaterial = (
  comet: CometUniforms,
  size: number,
  color: Color,
): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: {
      uHead: comet.uHead,
      uActivity: comet.uActivity,
      uSize: { value: size },
      uColor: { value: color },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: comaVert,
    fragmentShader: comaFrag,
  });

/** Orbit and environment shared by every dust grain of a comet. */
export interface CometDustUniforms {
  /** Orbital plane axes in world space: towards periapsis, and 90° ahead of it. */
  uOrbitP: { value: Vector3 };
  uOrbitQ: { value: Vector3 };
  uSemiMajorAxis: { value: number };
  uEccentricity: { value: number };
  /** The nucleus's current mean anomaly and mean motion (radians per second). */
  uMeanAnomaly: { value: number };
  uMeanMotion: { value: number };
  uTime: { value: number };
  uActivity: { value: number };
  /** Unit vector pointing away from the Sun. */
  uAxis: { value: Vector3 };
  /** Device pixels per world unit at distance 1 (for perspective point sizes). */
  uPointScale: { value: number };
  /** The nucleus's current position. */
  uHead: { value: Vector3 };
}

export interface CometDustOptions {
  color: Color;
  /** Seconds a grain stays visible after leaving the nucleus. */
  lifetime: number;
  /** Radiation-pressure acceleration (world units / s²) for the most strongly pushed grains. */
  pressure: number;
  /** Random ejection speed (world units / s). */
  spread: number;
  /** World-space grain glow size. */
  size: number;
  intensity: number;
  /**
   * How much of the grains' lag along the orbit to keep (0–1). Our comet moves far faster
   * than a real one so it can come back every ~20 s; at full lag the dust would trail straight
   * behind it instead of streaming away from the Sun. A fraction gives the gentle curve real
   * dust tails have.
   */
  orbitLag: number;
}

/**
 * Dust tail as individual grains. Each grain is released from the nucleus `age` seconds ago:
 * the shader solves Kepler's equation for where the nucleus *was* then, and adds the drift
 * since — radiation pressure pushing it straight away from the Sun (½·β·a·t², with β varying
 * per grain) plus a little ejection velocity. That reproduces the curved, fanned shape of real
 * dust tails (syndynes), lagging behind along the orbit.
 */
export const createCometDustMaterial = (
  dust: CometDustUniforms,
  { color, lifetime, pressure, spread, size, intensity, orbitLag }: CometDustOptions,
): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: {
      ...dust,
      uColor: { value: color },
      uLifetime: { value: lifetime },
      uPressure: { value: pressure },
      uSpread: { value: spread },
      uSize: { value: size },
      uIntensity: { value: intensity },
      uOrbitLag: { value: orbitLag },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: cometDustVert,
    fragmentShader: cometDustFrag,
  });

/* ---------------------------------------------------------------------------------------------
 * Interplanetary dust
 * ------------------------------------------------------------------------------------------- */

export interface SpaceDustUniforms {
  uCameraPos: { value: Vector3 };
  /** The camera's velocity (world units per second), for motion streaks. */
  uVelocity: { value: Vector3 };
  uTime: { value: number };
  /** Device pixels per world unit at distance 1. */
  uPointScale: { value: number };
}

export interface SpaceDustOptions {
  boxSize: number;
  size: number;
  intensity: number;
  drift: Vector3;
  /** Seconds of travel each streak spans, and the speeds over which streaks fade in. */
  streakTime: number;
  streakSpeeds: [number, number];
  /** Speeds over which the streaks thin out to a quarter of their number. */
  streakThinSpeeds: [number, number];
}

const dustUniforms = (
  dust: SpaceDustUniforms,
  lighting: LightingUniforms,
  { boxSize, size, intensity, drift, streakTime, streakSpeeds, streakThinSpeeds }: SpaceDustOptions,
  earth: { value: Vector4 },
) => ({
  ...lighting,
  ...dust,
  uEarth: earth,
  uBoxSize: { value: boxSize },
  uSize: { value: size },
  uIntensity: { value: intensity },
  uDrift: { value: drift },
  uStreakTime: { value: streakTime },
  uStreakSpeeds: { value: new Vector2(...streakSpeeds) },
  uStreakThinSpeeds: { value: new Vector2(...streakThinSpeeds) },
});

/**
 * Faint, sunlit motes in a box that wraps around the camera, so there is always dust nearby
 * wherever it flies. They give the empty space depth: parallax as the camera moves, and a
 * sense of speed in flight. Grains scatter mostly forwards, so they glow looking towards the
 * Sun, and the Earth's shadow darkens them. `position` holds each grain's place in a unit cube.
 */
export const createSpaceDustMaterial = (
  dust: SpaceDustUniforms,
  lighting: LightingUniforms,
  options: SpaceDustOptions,
  earth: { value: Vector4 },
): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: dustUniforms(dust, lighting, options, earth),
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: glsl(DUST_VERTEX, spaceDustVert),
    fragmentShader: spaceDustFrag,
  });

/**
 * The same grains drawn as short lines trailing behind the camera's motion, fading in only at
 * high speed: the streaks that sell velocity in flight. Each grain has two vertices (`aEnd`
 * 0 = head, 1 = tail) sharing one position.
 */
export const createDustStreakMaterial = (
  dust: SpaceDustUniforms,
  lighting: LightingUniforms,
  options: SpaceDustOptions,
  earth: { value: Vector4 },
): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: dustUniforms(dust, lighting, options, earth),
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: glsl(DUST_VERTEX, dustStreakVert),
    fragmentShader: dustStreakFrag,
  });

/* ---------------------------------------------------------------------------------------------
 * Earth's night side: aurorae and thunderstorms
 * ------------------------------------------------------------------------------------------- */

/**
 * A thin additive shell just above the clouds (a child of the cloud mesh, so it shares their
 * UVs). On the night side it shows auroral ovals around the magnetic poles, rippling slowly,
 * and scattered thunderstorms flickering inside the cloud tops.
 */
export const createEarthNightMaterial = (
  clouds: Texture,
  lighting: LightingUniforms,
  time: { value: number },
  flashes: { value: number },
): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: { ...lighting, uClouds: { value: clouds }, uTime: time, uFlashes: flashes },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: sphereVert,
    fragmentShader: glsl(COMMON, SPHERE_VARYINGS, NOISE, earthNightFrag),
  });

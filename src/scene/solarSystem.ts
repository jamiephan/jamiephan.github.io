/**
 * Everything beyond the Earth–Moon system: the other planets, an asteroid belt and a comet.
 *
 * Sizes keep their real ratios (Jupiter is 11 Earths wide). Distances are heavily compressed,
 * but the order from the Sun is real; see `layout.ts` for where everything sits.
 */
import {
  BufferAttribute,
  BufferGeometry,
  type Camera,
  Color,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Mesh,
  Object3D,
  PlaneGeometry,
  Points,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
  Vector4,
  type Texture,
} from "three";

import jupiterUrl from "../assets/textures/jupiter.webp";
import marsUrl from "../assets/textures/mars.webp";
import mercuryUrl from "../assets/textures/mercury.webp";
import neptuneUrl from "../assets/textures/neptune.webp";
import saturnRingUrl from "../assets/textures/saturn-ring.png";
import saturnUrl from "../assets/textures/saturn.webp";
import uranusUrl from "../assets/textures/uranus.webp";
import venusUrl from "../assets/textures/venus.webp";
import {
  createAsteroidMaterial,
  createCloudyPlanetMaterial,
  createComaMaterial,
  createCometDustMaterial,
  createCometTailMaterial,
  createRingMaterial,
  createRingUniforms,
  createRockyMaterial,
  type CometDustUniforms,
  type CometUniforms,
  type LightingUniforms,
} from "./materials.ts";
import type { BodyId } from "./bodies.ts";
import {
  BELT_LAYOUT,
  ECLIPTIC_NORMAL,
  EARTH_RADIUS,
  PLANET_POSITIONS,
  SUN_DIRECTION,
  spinAxis,
  type PlanetId,
} from "./layout.ts";
import { degToRad } from "./math.ts";
import { meanAnomalyAt, orbitAt, periodForHiddenTime, visibleFraction } from "./orbit.ts";
import { mulberry32 } from "./stars.ts";

export type TextureLoad = (url: string, options?: { color?: boolean; sharp?: boolean }) => Texture;

const Y_AXIS = new Vector3(0, 1, 0);
const scratch = new Vector3();

interface PlanetSpec {
  id: PlanetId;
  url: string;
  /** Radius in Earth radii. */
  radius: number;
  /** Spin axis: obliquity (degrees from the ecliptic normal) and which way it leans. */
  pole: { obliquity: number; azimuth: number };
  /** Spin in degrees per second, about the pole. */
  spin: number;
  /** Polar radius / equatorial radius. */
  oblateness?: number;
  surface: "rocky" | "cloudy";
  rim?: Color;
  limbDarkening?: number;
  rings?: { url: string; inner: number; outer: number };
}

/** Real radii and axial tilts; positions are in `layout.ts`. */
const PLANETS: readonly PlanetSpec[] = [
  {
    id: "mercury",
    url: mercuryUrl,
    radius: 0.383,
    pole: { obliquity: 0, azimuth: 0 },
    spin: 0.5,
    surface: "rocky",
  },
  {
    // Upside down (tilt 177°), so it turns backwards.
    id: "venus",
    url: venusUrl,
    radius: 0.949,
    pole: { obliquity: 177, azimuth: 0 },
    spin: 0.6,
    surface: "cloudy",
    rim: new Color(0.35, 0.3, 0.18),
    limbDarkening: 0.15,
  },
  {
    id: "mars",
    url: marsUrl,
    radius: 0.532,
    pole: { obliquity: 25, azimuth: 40 },
    spin: 3,
    surface: "rocky",
    rim: new Color(0.12, 0.07, 0.05),
  },
  {
    id: "jupiter",
    url: jupiterUrl,
    radius: 11.21,
    pole: { obliquity: 3, azimuth: 0 },
    spin: 6,
    oblateness: 0.935,
    surface: "cloudy",
    rim: new Color(0.06, 0.05, 0.04),
  },
  {
    id: "saturn",
    url: saturnUrl,
    radius: 9.45,
    // Leaning so the rings open ~22° towards the default camera.
    pole: { obliquity: 26.7, azimuth: 90 },
    spin: 5,
    oblateness: 0.9,
    surface: "cloudy",
    rim: new Color(0.05, 0.045, 0.03),
    rings: { url: saturnRingUrl, inner: 1.24, outer: 2.27 },
  },
  {
    // Knocked on its side: the spin axis lies almost in the plane of its orbit.
    id: "uranus",
    url: uranusUrl,
    radius: 4.01,
    pole: { obliquity: 98, azimuth: 60 },
    spin: 4,
    surface: "cloudy",
    rim: new Color(0.1, 0.2, 0.22),
    limbDarkening: 0.2,
  },
  {
    id: "neptune",
    url: neptuneUrl,
    radius: 3.88,
    pole: { obliquity: 28, azimuth: 200 },
    spin: 4,
    surface: "cloudy",
    rim: new Color(0.06, 0.12, 0.3),
    limbDarkening: 0.25,
  },
];

/* ---------- Asteroid belt ---------- */

const BELT = {
  ...BELT_LAYOUT,
  count: 7000,
  /** Units per second the rocks drift along the band (they're orbiting the Sun). */
  speed: 1.5,
} as const;

/* ---------- Comet ---------- */

/**
 * A periodic comet. The slow, far end of its orbit (apoapsis) arcs across the top of the
 * default view; it then whips round its close end behind the camera and comes back. Its
 * period is fitted to the viewport (see `fitCometToView`) so it is out of view for about
 * `hiddenSeconds` per orbit on any screen shape.
 */
const COMET_APOAPSIS = new Vector3(0, 1, 0.38).normalize();
const COMET = {
  /** Orbital plane axes: x towards periapsis (opposite apoapsis)… */
  periapsis: COMET_APOAPSIS.clone().negate(),
  /** …and y, chosen so the comet crosses the view left → right (it moves along −y at apoapsis). */
  plane: new Vector3(-1, 0, 0.15).projectOnPlane(COMET_APOAPSIS).normalize(),
  /** Apoapsis distance 300, periapsis 100. */
  semiMajorAxis: 200,
  eccentricity: 0.5,
  /** Seconds out of view per orbit. */
  hiddenSeconds: 20,
  /** Start just before it swings into view, so it shows up soon after the page loads. */
  startMeanAnomaly: meanAnomalyAt(Math.PI - degToRad(50), 0.5),
  /** How far the dust glow bends back along the orbit. */
  dustLag: 0.12,
  /** Number of simulated dust grains. */
  dustGrains: 6000,
} as const;

/** Something the explore-mode camera can fly to and follow. */
export interface FocusTarget {
  radius: number;
  /** Comfortable viewing distance from its centre. */
  viewDistance: number;
  getPosition: (out: Vector3) => Vector3;
}

export interface SolarSystem {
  group: Group;
  /** The planets and the comet, by id. */
  targets: Map<BodyId, FocusTarget>;
  /** Advance animation by `seconds` (0 when reduced motion is on). */
  update: (seconds: number) => void;
  /**
   * Turn the planets and belt by `frame` (mouse parallax only: drifting with the sky would carry
   * them round the Earth and out of order from the Sun), and the comet's orbit by `cometFrame`
   * (so it keeps coming back into view). Also re-aims world-space uniforms used for shading.
   */
  setOrientation: (frame: Quaternion, cometFrame: Quaternion) => void;
  /**
   * Fit the comet's orbital period to what `camera` (in its default pose) can see, so it
   * spends `COMET.hiddenSeconds` out of view per orbit. Returns the new period in seconds.
   */
  fitCometToView: (camera: Camera) => number;
  /** Device pixels per world unit at distance 1, for sizing comet dust grains. */
  setPointScale: (scale: number) => void;
}

export const createSolarSystem = (load: TextureLoad, lighting: LightingUniforms): SolarSystem => {
  const group = new Group();
  const spinners: { mesh: Mesh; speed: number }[] = [];
  const targets = new Map<BodyId, FocusTarget>();
  /** World-space uniforms that must follow the group's rotation. */
  const rotated: { value: Vector3; base: Vector3 }[] = [];
  const planetSpheres: { value: Vector4; base: Vector3 }[] = [];

  for (const spec of PLANETS) {
    const radius = spec.radius * EARTH_RADIUS;
    const position = PLANET_POSITIONS[spec.id];
    const pole = spinAxis(spec.pole.obliquity, spec.pole.azimuth);
    const system = new Group();
    system.position.copy(position);
    system.quaternion.setFromUnitVectors(Y_AXIS, pole);

    const map = load(spec.url);
    let ringUniforms;
    if (spec.rings) {
      ringUniforms = createRingUniforms(
        load(spec.rings.url),
        spec.rings.inner * radius,
        spec.rings.outer * radius,
      );
      rotated.push(
        { value: ringUniforms.uRingNormal.value, base: pole },
        { value: ringUniforms.uRingCenter.value, base: position },
      );
      const sphere = { value: new Vector4(0, 0, 0, radius) };
      planetSpheres.push({ value: sphere.value, base: position });

      const rings = new Mesh(
        new RingGeometry(spec.rings.inner * radius, spec.rings.outer * radius, 192, 1),
        createRingMaterial(lighting, ringUniforms, sphere),
      );
      rings.rotation.x = -Math.PI / 2;
      system.add(rings);
    }

    const material =
      spec.surface === "rocky"
        ? createRockyMaterial(map, lighting, {
            bump: 5,
            rim: spec.rim,
          })
        : createCloudyPlanetMaterial(map, lighting, {
            ring: ringUniforms,
            rim: spec.rim,
            limbDarkening: spec.limbDarkening,
          });

    // Tessellation scales with size: the small ones are only ever a few pixels wide.
    const segments = radius > 10 ? 96 : 48;
    const planet = new Mesh(new SphereGeometry(radius, segments, segments / 2), material);
    planet.scale.y = spec.oblateness ?? 1;
    system.add(planet);
    group.add(system);
    spinners.push({ mesh: planet, speed: spec.spin });
    targets.set(spec.id, {
      radius,
      // Pull back further for ringed planets so the whole ring system fits.
      viewDistance: radius * (spec.rings ? 2.8 * spec.rings.outer : 4),
      getPosition: (out) => planet.getWorldPosition(out),
    });
  }

  /** Drive each rock's tumble, and the rocks' drift along the band. */
  const beltTime = { value: 0 };
  const beltShift = { value: 0 };
  const belt = createAsteroidBelt(lighting, beltTime, beltShift);
  const comet = createComet(lighting);
  group.add(belt, comet.group);

  const setOrientation = (backdrop: Quaternion, cometFrame: Quaternion): void => {
    group.quaternion.copy(backdrop);
    for (const { value, base } of rotated) value.copy(base).applyQuaternion(backdrop);
    for (const { value, base } of planetSpheres) {
      const { x, y, z } = scratch.copy(base).applyQuaternion(backdrop);
      value.set(x, y, z, value.w);
    }
    comet.place(cometFrame);
  };
  setOrientation(new Quaternion(), new Quaternion());

  targets.set("comet", {
    radius: 3,
    // Far enough back to take in the tails.
    viewDistance: 110,
    getPosition: (out) => out.copy(comet.uniforms.uHead.value),
  });

  return {
    group,
    targets,
    update: (seconds) => {
      for (const { mesh, speed } of spinners) mesh.rotation.y += degToRad(speed * seconds);
      // Kept small so the float stays precise; the shader wraps it round the band anyway.
      beltShift.value = (beltShift.value + BELT.speed * seconds) % BELT.length;
      beltTime.value += seconds;
      comet.advance(seconds);
    },
    setOrientation,
    fitCometToView: comet.fitToView,
    setPointScale: comet.setPointScale,
  };
};

/** A rough, faceted rock: an icosphere with deterministic per-vertex dents. */
const createRockGeometry = (): BufferGeometry => {
  const geometry = new IcosahedronGeometry(1, 1);
  const position = geometry.getAttribute("position") as BufferAttribute;
  const v = new Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i);
    // Hash the (shared) vertex position so faces stay stitched together.
    const h = Math.sin(v.x * 12.9898 + v.y * 78.233 + v.z * 37.719) * 43758.5453;
    v.multiplyScalar(0.75 + 0.45 * (h - Math.floor(h)));
    position.setXYZ(i, v.x, v.y, v.z);
  }
  geometry.computeVertexNormals(); // non-indexed → flat facets
  return geometry;
};

const createAsteroidBelt = (
  lighting: LightingUniforms,
  beltTime: { value: number },
  beltShift: { value: number },
): InstancedMesh => {
  const random = mulberry32(2024);
  const belt = new InstancedMesh(
    createRockGeometry(),
    createAsteroidMaterial(lighting, beltTime, { shift: beltShift, length: BELT.length }),
    BELT.count,
  );
  const dummy = new Object3D();
  const color = new Color();

  for (let i = 0; i < BELT.count; i++) {
    // Local frame: x along the band, y the ecliptic normal, z towards the Sun. Denser towards
    // the middle of the band; thin and slightly flared vertically.
    const t = (random() + random() + random()) / 3;
    const depth = BELT.inner + (BELT.outer - BELT.inner) * t;
    const along = (random() - 0.5) * BELT.length;
    const height = (random() + random() - 1) * BELT.thickness;
    dummy.position.set(along, height, -depth);

    // Size distribution: lots of small rocks, a few big ones.
    const size = Math.min(1.8, 0.2 * (1 - random()) ** -0.45);
    dummy.scale.set(
      size * (0.7 + random() * 0.5),
      size * (0.6 + random() * 0.4),
      size * (0.7 + random() * 0.5),
    );
    dummy.rotation.set(random() * 6.3, random() * 6.3, random() * 6.3);
    dummy.updateMatrix();
    belt.setMatrixAt(i, dummy.matrix);

    // Carbonaceous greys to stony browns.
    const albedo = 0.09 + random() * 0.13;
    const warmth = random();
    belt.setColorAt(
      i,
      color.setRGB(albedo * (1 + 0.25 * warmth), albedo * (1 + 0.1 * warmth), albedo * 0.95),
    );
  }

  const along = new Vector3().crossVectors(ECLIPTIC_NORMAL, SUN_DIRECTION).normalize();
  belt.quaternion.setFromRotationMatrix(
    new Matrix4().makeBasis(
      along,
      ECLIPTIC_NORMAL,
      new Vector3().crossVectors(along, ECLIPTIC_NORMAL),
    ),
  );
  belt.instanceMatrix.needsUpdate = true;
  // The rocks drift in the shader, so the computed bounds would be wrong.
  belt.frustumCulled = false;
  return belt;
};

/** Ribbon geometry for a comet tail: `aTail` = (along 0→1, across -1→1). */
const createTailGeometry = (segments: number): BufferGeometry => {
  const tail = new Float32Array((segments + 1) * 2 * 2);
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const s = i / segments;
    tail.set([s, -1, s, 1], i * 4);
    if (i < segments) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("aTail", new BufferAttribute(tail, 2));
  // `position` is required by three.js; the vertex shader builds the real positions.
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(tail.length * 1.5), 3));
  geometry.setIndex(indices);
  return geometry;
};

interface Comet {
  group: Group;
  uniforms: CometUniforms;
  fitToView: (camera: Camera) => number;
  setPointScale: (scale: number) => void;
  /** Move along the orbit. */
  advance: (seconds: number) => void;
  /** Recompute world-space uniforms with the orbit turned by `frame`. */
  place: (frame: Quaternion) => void;
}

/** Per-grain random attributes for the dust tail (see `createCometDustMaterial`). */
const createDustGeometry = (count: number): BufferGeometry => {
  const random = mulberry32(7);
  const randoms = new Float32Array(count * 4);
  const directions = new Float32Array(count * 3);
  const direction = new Vector3();
  for (let i = 0; i < count; i++) {
    randoms.set([random(), random(), random(), random()], i * 4);
    direction.set(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1).normalize();
    directions.set([direction.x, direction.y, direction.z], i * 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("aRandom", new BufferAttribute(randoms, 4));
  geometry.setAttribute("aDirection", new BufferAttribute(directions, 3));
  // `position` is required by three.js; the vertex shader computes the real positions.
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(count * 3), 3));
  return geometry;
};

const createComet = (lighting: LightingUniforms): Comet => {
  const antiSun = lighting.uSunDir.value.clone().negate();
  const uniforms: CometUniforms = {
    uHead: { value: new Vector3() },
    // Tails always point directly away from the Sun, whichever way the comet is moving.
    uAxis: { value: antiSun },
    uCurve: { value: new Vector3() },
    uTime: { value: 0 },
    uActivity: { value: 1 },
  };
  let meanAnomaly = COMET.startMeanAnomaly;
  let period = 40;
  let frame = new Quaternion();
  const velocity = new Vector3();
  const sunDirection = lighting.uSunDir.value;

  const dust: CometDustUniforms = {
    uOrbitP: { value: new Vector3() },
    uOrbitQ: { value: new Vector3() },
    uSemiMajorAxis: { value: COMET.semiMajorAxis },
    uEccentricity: { value: COMET.eccentricity },
    uMeanAnomaly: { value: meanAnomaly },
    uMeanMotion: { value: (2 * Math.PI) / period },
    uTime: uniforms.uTime,
    uActivity: uniforms.uActivity,
    uAxis: uniforms.uAxis,
    uPointScale: { value: 800 },
    uHead: uniforms.uHead,
  };

  const group = new Group();
  // Blue ion tail: gas blown straight away from the Sun by the solar wind.
  const ionTail = new Mesh(
    createTailGeometry(48),
    createCometTailMaterial(
      { ...uniforms, uCurve: { value: new Vector3() } },
      {
        color: new Color(0.45, 0.65, 1),
        length: 95,
        width: 3.2,
        intensity: 0.6,
        streamers: 0.6,
      },
    ),
  );
  // Dust tail: individual grains shed along the orbit and pushed out by sunlight...
  const dustGrains = new Points(
    createDustGeometry(COMET.dustGrains),
    createCometDustMaterial(dust, {
      color: new Color(1, 0.86, 0.66),
      lifetime: 6,
      pressure: 9,
      spread: 1,
      size: 1.8,
      intensity: 0.06,
      orbitLag: 0.25,
    }),
  );
  // ...over a faint continuous glow so the tail never looks grainy from afar.
  const dustTail = new Mesh(
    createTailGeometry(48),
    createCometTailMaterial(uniforms, {
      color: new Color(1, 0.88, 0.7),
      length: 55,
      width: 8,
      intensity: 0.14,
      streamers: 0,
    }),
  );
  // Comae glow faintly green (diatomic carbon fluorescing in sunlight).
  const coma = new Mesh(
    new PlaneGeometry(2, 2),
    createComaMaterial(uniforms, 4, new Color(0.68, 1, 0.8)),
  );

  for (const mesh of [ionTail, dustTail, dustGrains, coma]) {
    // Positions are generated in the vertex shader, so bounds are meaningless.
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  dustTail.renderOrder = 1;
  dustGrains.renderOrder = 2;
  ionTail.renderOrder = 3;
  coma.renderOrder = 4;

  const place = (next: Quaternion): void => {
    frame = next;
    // The Sun can be moved while exploring, so re-aim the tails every frame.
    antiSun.copy(sunDirection).negate();
    const { x, y, vx, vy } = orbitAt(meanAnomaly, COMET.semiMajorAxis, COMET.eccentricity);
    uniforms.uHead.value
      .copy(COMET.periapsis)
      .multiplyScalar(x)
      .addScaledVector(COMET.plane, y)
      .applyQuaternion(frame);
    velocity
      .copy(COMET.periapsis)
      .multiplyScalar(vx)
      .addScaledVector(COMET.plane, vy)
      .applyQuaternion(frame);

    // Dust lags a little behind the nucleus: bend the glow gently away from the direction of
    // travel (matching the grains' reduced orbit lag).
    uniforms.uCurve.value
      .copy(velocity)
      .negate()
      .projectOnPlane(antiSun)
      .normalize()
      .multiplyScalar(COMET.dustLag);

    // Grains are placed on the orbit in the shader, so it needs the orbit in world space.
    dust.uOrbitP.value.copy(COMET.periapsis).applyQuaternion(frame);
    dust.uOrbitQ.value.copy(COMET.plane).applyQuaternion(frame);
    dust.uMeanAnomaly.value = meanAnomaly;
    dust.uMeanMotion.value = (2 * Math.PI) / period;

    // Outgassing grows as the comet swings towards the Sun's side of its arc.
    const sunward = uniforms.uHead.value.dot(sunDirection);
    uniforms.uActivity.value = 0.6 + 0.4 * MathUtils.smoothstep(sunward, -250, 250);
  };

  const fitToView = (camera: Camera): number => {
    const point = new Vector3();
    const fraction = visibleFraction(
      (x, y) => {
        point.copy(COMET.periapsis).multiplyScalar(x).addScaledVector(COMET.plane, y);
        point.project(camera);
        return Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1 && Math.abs(point.z) <= 1;
      },
      COMET.semiMajorAxis,
      COMET.eccentricity,
    );
    period = periodForHiddenTime(COMET.hiddenSeconds, fraction);
    return period;
  };

  return {
    group,
    uniforms,
    fitToView,
    setPointScale: (scale) => (dust.uPointScale.value = scale),
    advance: (seconds) => {
      uniforms.uTime.value += seconds;
      meanAnomaly = (meanAnomaly + (2 * Math.PI * seconds) / period) % (2 * Math.PI);
      place(frame);
    },
    place,
  };
};

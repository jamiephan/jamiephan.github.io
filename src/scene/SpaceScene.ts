import {
  ACESFilmicToneMapping,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  LinearFilter,
  LoadingManager,
  Matrix4,
  Mesh,
  NoColorSpace,
  PerspectiveCamera,
  Quaternion,
  Points,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  Vector4,
  WebGLRenderer,
  type Material,
  type Object3D,
  type Texture,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import earthCloudsUrl from "../assets/textures/earth-clouds.webp";
import earthDayUrl from "../assets/textures/earth-day.webp";
import earthNightUrl from "../assets/textures/earth-night.webp";
import earthNormalUrl from "../assets/textures/earth-normal.webp";
import earthSpecularUrl from "../assets/textures/earth-specular.webp";
import milkyWayUrl from "../assets/textures/milky-way.webp";
import moonUrl from "../assets/textures/moon.webp";
import {
  createAtmosphereMaterial,
  createCloudMaterial,
  createEarthMaterial,
  createLightingUniforms,
  createRockyMaterial,
  createSkyMaterial,
  createStarMaterial,
} from "./materials.ts";
import { degToRad, lerp, perFrameAt60, scrollProgress } from "./math.ts";
import { DEFAULT_BODY, type BodyId } from "./bodies.ts";
import { createSolarSystem, type FocusTarget, type SolarSystem } from "./solarSystem.ts";
import { previewFor } from "./textures.ts";
import { generateStarfield } from "./stars.ts";

/* ---------- Layout (world units; +Z is "up" on screen, the camera looks along +Y) ---------- */

const MIN_DISTANCE = 25;
const MAX_DISTANCE = 50;

/** Real size ratios; distances are compressed so everything fits in one view. */
const EARTH_RADIUS = 4;
const CLOUD_RADIUS = EARTH_RADIUS * 1.006;
const ATMOSPHERE_RADIUS = EARTH_RADIUS * 1.035;
const EARTH_AXIAL_TILT = degToRad(23.44);
const MOON_RADIUS = EARTH_RADIUS * 0.273;
const MOON_ORBIT_RADIUS = 14;
const MOON_ORBIT_TILT = -0.2;

/** Direction towards the Sun: off-screen to the right so the Earth shows a bright gibbous face. */
const SUN_DIRECTION = new Vector3(1, -0.35, 0.25).normalize();
const SUN_COLOR = new Color(1, 0.96, 0.9).multiplyScalar(1.25);

/** The sky sits well beyond the furthest planet (and the camera's far plane covers it). */
const SKY_RADIUS = 1500;
const STAR_RADIUS = 1400;
const STAR_COUNT = 4500;

/** Degrees per second. */
const SPEED = {
  sky: 0.35,
  earth: 4,
  clouds: 0.35,
  moonOrbit: 1.5,
} as const;

/** Mouse parallax: pixels of movement per degree of rotation, and jump threshold. */
const PAN_SLOWNESS = 500;
const PAN_THRESHOLD = 200;

/** Higher = camera follows scroll faster. */
const ZOOM_SMOOTHING = 8;
/**
 * By the bottom of the page the camera has swung this far round the Earth (away from the Sun,
 * so the night side and city lights come into view) and risen this far above the orbital plane.
 */
const SCROLL_ORBIT_AZIMUTH = degToRad(-75);
const SCROLL_ORBIT_ELEVATION = degToRad(16);

/** Adaptive resolution: drop the pixel ratio if we can't hold this frame rate. */
const TARGET_FPS = 45;
const PERF_SAMPLE_SECONDS = 2;
const MIN_PIXEL_RATIO = 1;

const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);
const Z_AXIS = new Vector3(0, 0, 1);
const SKY_DRIFT_AXIS = new Vector3(0.3, 0.2, 1).normalize();

export const isWebGL2Available = (): boolean => {
  try {
    return document.createElement("canvas").getContext("webgl2") !== null;
  } catch {
    return false;
  }
};

export interface SpaceSceneOptions {
  /** Called once all textures have loaded, shaders are compiled and the first frame can be shown. */
  onReady?: () => void;
  /** Called when the focused body changes from inside the scene (tapping a planet, resetting). */
  onFocusChange?: (id: BodyId) => void;
}

/** Explore mode: seconds to fly between bodies, and hold-to-zoom speed (e-folds per second). */
const FOCUS_SECONDS = 1.6;
const HOLD_ZOOM_RATE = 1.4;
/** Distance factor for one zoom step (a tap or keypress). */
const ZOOM_STEP = 0.7;
/** How quickly the camera eases towards the zoom goal (higher = snappier). */
const ZOOM_EASE = 10;
/** A press shorter than this counts as a tap (one step) rather than a hold. */
const ZOOM_TAP_SECONDS = 0.2;
/** A tap shorter than this, moving less than this, picks a body. */
const TAP_MAX_MS = 350;
const TAP_MAX_MOVE = 8;
/** Small bodies stay tappable within this many CSS pixels of their centre. */
const TAP_MIN_RADIUS = 28;

const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

interface FocusTransition {
  from: Vector3;
  fromDistance: number;
  toDistance: number;
  /** Optionally swing the camera round to a viewing direction (unit, target to camera). */
  fromDirection: Vector3;
  toDirection: Vector3 | null;
  progress: number;
}

/**
 * The animated solar-system background: Earth, Moon, planets, asteroid belt, comet and Milky Way.
 *
 * Owns its own canvas, renderer and event listeners; call `dispose()` to release everything.
 */
export class SpaceScene {
  readonly #container: HTMLElement;
  readonly #renderer: WebGLRenderer;
  readonly #scene = new Scene();
  readonly #camera: PerspectiveCamera;
  readonly #controls: OrbitControls;
  readonly #textures: Texture[] = [];
  /** Textures showing a low-res preview, and the full-resolution file to swap in later. */
  #pendingDetail: { texture: Texture; url: string }[] = [];
  readonly #resizeObserver: ResizeObserver;
  readonly #reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  readonly #abort = new AbortController();

  /** Background (Milky Way, stars) — follows the camera and drifts slowly. */
  readonly #sky = new Group();
  /** The sky's starting orientation (where the galaxy sits relative to the Earth). */
  readonly #skyBase = new Quaternion();
  /** Slow automatic drift of the whole backdrop. */
  readonly #drift = new Quaternion();
  /** Mouse parallax. */
  readonly #parallax = new Quaternion();
  /** parallax × drift: applied to everything except the Earth. */
  readonly #backdrop = new Quaternion();
  readonly #turn = new Quaternion();
  /** Carries the Moon's orbit, so the Moon turns with the backdrop too. */
  readonly #moonFrame = new Group();
  readonly #starMaterial: ShaderMaterial;
  readonly #earth: Mesh;
  readonly #clouds: Mesh;
  readonly #cloudMaterial: ShaderMaterial;
  readonly #earthMaterial: ShaderMaterial;
  readonly #moonOrbit = new Group();
  readonly #moonPivot = new Group();
  readonly #moon: Mesh;
  /** The Moon as a shadow-casting sphere, shared by the Earth and cloud shaders. */
  readonly #moonOccluder = { value: new Vector4(0, 0, 0, MOON_RADIUS) };
  readonly #solarSystem: SolarSystem;

  readonly #scratch = new Vector3();
  /** The camera in its default (non-explore) pose, used to time the comet's orbit. */
  readonly #viewProbe = new PerspectiveCamera(60, 1, 0.5, 3000);
  readonly #focusPoint = new Vector3();
  readonly #offset = new Vector3();
  /** Everything the explore camera can fly to. */
  readonly #targets = new Map<BodyId, FocusTarget>();
  readonly #onFocusChange: ((id: BodyId) => void) | undefined;

  #focusId: BodyId = DEFAULT_BODY;
  #transition: FocusTransition | null = null;
  /** A zoom button being held, and the goal distance when it was pressed. */
  #zoom: { direction: number; held: number; from: number } | null = null;
  /** Distance the camera is easing towards after zoom buttons (null when idle). */
  #zoomGoal: number | null = null;
  #tap: { id: number; x: number; y: number; time: number } | null = null;

  #disposed = false;
  #exploring = false;
  #reducedMotion = this.#reducedMotionQuery.matches;
  /** Scroll progress (0–1) the camera is showing, easing towards the page's actual progress. */
  #progress = 0;
  #targetProgress = 0;
  /** Swing round the Earth driven by scroll; the default camera pose is rotated by this. */
  readonly #orbit = new Quaternion();
  readonly #orbitStep = new Quaternion();
  /** The camera's orientation at the start of the page (looking at the Earth). */
  readonly #baseView = new Quaternion();
  readonly #cometFrame = new Quaternion();
  #lastPointer: { x: number; y: number } | null = null;
  #lastTime: number | null = null;
  #needsRender = true;
  #ready = false;
  #perf = { time: 0, frames: 0 };

  constructor(container: HTMLElement, { onReady, onFocusChange }: SpaceSceneOptions = {}) {
    this.#container = container;
    this.#onFocusChange = onFocusChange;

    // Renderer — cap DPR at 2; beyond that costs a lot of fill-rate for no visible gain.
    this.#renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.toneMapping = ACESFilmicToneMapping;
    this.#renderer.toneMappingExposure = 1;
    container.append(this.#renderer.domElement);

    this.#camera = new PerspectiveCamera(60, 1, 0.5, 3000);
    this.#camera.up.set(0, 0, 1);
    this.#camera.position.set(0, -MIN_DISTANCE, 0);
    this.#camera.lookAt(0, 0, 0);
    this.#baseView.copy(this.#camera.quaternion);

    // Textures — fade the canvas in only once they've all arrived.
    let resolveTextures!: () => void;
    const texturesLoaded = new Promise<void>((resolve) => (resolveTextures = resolve));
    const manager = new LoadingManager(resolveTextures);
    manager.onError = (url) => console.warn(`Failed to load texture: ${url}`);
    const loader = new TextureLoader(manager);
    const anisotropy = Math.min(8, this.#renderer.capabilities.getMaxAnisotropy());
    const load = (url: string, { color = true, sharp = false } = {}): Texture => {
      // Start with the small preview if there is one; `#loadDetail` fetches the rest later.
      const preview = previewFor(url);
      const texture = loader.load(preview ?? url, () => (this.#needsRender = true));
      if (preview) this.#pendingDetail.push({ texture, url });
      texture.colorSpace = color ? SRGBColorSpace : NoColorSpace;
      if (sharp) texture.anisotropy = anisotropy;
      this.#textures.push(texture);
      return texture;
    };

    const lighting = createLightingUniforms(SUN_DIRECTION, SUN_COLOR);

    /* ---------- Sky ---------- */
    const milkyWay = load(milkyWayUrl);
    // Magnified everywhere, so mipmaps would only cost memory (and cause a seam at the wrap).
    milkyWay.generateMipmaps = false;
    milkyWay.minFilter = LinearFilter;
    milkyWay.wrapS = RepeatWrapping;

    const skyMesh = new Mesh(
      new SphereGeometry(SKY_RADIUS, 64, 32),
      createSkyMaterial(milkyWay, lighting),
    );
    skyMesh.renderOrder = -2;
    skyMesh.frustumCulled = false;

    this.#starMaterial = createStarMaterial(lighting);
    const stars = this.#createStars();

    // Orient the galaxy so its bright core sits diagonally behind the Earth.
    const galacticCentre = new Vector3(0.25, 1, 0.12).normalize();
    const galacticNorth = new Vector3(0.75, -0.1, 1).projectOnPlane(galacticCentre).normalize();
    this.#sky.quaternion.setFromRotationMatrix(
      new Matrix4().makeBasis(
        galacticCentre,
        galacticNorth,
        new Vector3().crossVectors(galacticCentre, galacticNorth),
      ),
    );
    this.#sky.add(skyMesh, stars);
    this.#skyBase.copy(this.#sky.quaternion);

    /* ---------- Earth ---------- */
    const earthTextures = {
      day: load(earthDayUrl, { sharp: true }),
      night: load(earthNightUrl),
      normal: load(earthNormalUrl, { color: false, sharp: true }),
      specular: load(earthSpecularUrl, { color: false }),
      clouds: load(earthCloudsUrl, { color: false, sharp: true }),
    };

    // Tilt the spin axis towards the Sun (northern summer), then spin about local +Y.
    const earthTilt = new Group();
    earthTilt.quaternion.setFromUnitVectors(
      Y_AXIS,
      new Vector3(Math.sin(EARTH_AXIAL_TILT), 0, Math.cos(EARTH_AXIAL_TILT)),
    );

    this.#earthMaterial = createEarthMaterial(earthTextures, lighting, this.#moonOccluder);
    this.#earth = new Mesh(new SphereGeometry(EARTH_RADIUS, 128, 64), this.#earthMaterial);
    // Start with Europe and Africa facing the camera.
    this.#earth.rotation.y = Math.PI / 2 - 2 * Math.PI * ((15 + 180) / 360);

    this.#cloudMaterial = createCloudMaterial(earthTextures.clouds, lighting, this.#moonOccluder);
    this.#clouds = new Mesh(new SphereGeometry(CLOUD_RADIUS, 128, 64), this.#cloudMaterial);
    this.#clouds.renderOrder = 1;
    this.#earth.add(this.#clouds);
    earthTilt.add(this.#earth);

    const atmosphere = new Mesh(
      new SphereGeometry(ATMOSPHERE_RADIUS, 96, 48),
      createAtmosphereMaterial(lighting, EARTH_RADIUS, ATMOSPHERE_RADIUS),
    );
    atmosphere.renderOrder = 2;

    /* ---------- Moon (tidally locked: the same face always points at the Earth) ---------- */
    this.#moon = new Mesh(
      new SphereGeometry(MOON_RADIUS, 64, 32),
      createRockyMaterial(load(moonUrl, { sharp: true }), lighting, {
        // The Earth eclipses the Moon, and lights its night side (earthshine).
        occluder: { value: new Vector4(0, 0, 0, EARTH_RADIUS) },
        ambient: new Color(0.015, 0.02, 0.03),
      }),
    );
    this.#moon.position.set(MOON_ORBIT_RADIUS, 0, 0);
    this.#moon.rotation.set(Math.PI / 2, Math.PI, 0);
    this.#moonPivot.rotation.z = -0.4;
    this.#moonPivot.add(this.#moon);
    this.#moonOrbit.rotation.x = MOON_ORBIT_TILT;
    this.#moonOrbit.add(this.#moonPivot);
    this.#moonFrame.add(this.#moonOrbit);

    /* ---------- Other planets, asteroid belt, comet ---------- */
    this.#solarSystem = createSolarSystem(load, lighting);

    this.#scene.add(this.#sky, earthTilt, atmosphere, this.#moonFrame, this.#solarSystem.group);

    this.#targets.set("earth", {
      radius: EARTH_RADIUS,
      viewDistance: MIN_DISTANCE,
      getPosition: (out) => out.set(0, 0, 0),
    });
    this.#targets.set("moon", {
      radius: MOON_RADIUS,
      viewDistance: MOON_RADIUS * 5,
      getPosition: (out) => this.#moon.getWorldPosition(out),
    });
    for (const [id, target] of this.#solarSystem.targets) this.#targets.set(id, target);

    // Orbit controls are only attached while exploring (see `setExploring`).
    this.#controls = new OrbitControls(this.#camera);
    this.#controls.enabled = false;
    this.#controls.enableDamping = true;
    // The camera follows the focused body, so panning away from it would just snap back.
    this.#controls.enablePan = false;
    this.#setDistanceLimits(this.#targets.get(DEFAULT_BODY)!);
    this.#controls.saveState();
    this.#controls.addEventListener("change", () => (this.#needsRender = true));
    // Wheel, pinch or drag takes over from any zoom-button easing still in progress.
    this.#controls.addEventListener("start", () => (this.#zoomGoal = null));

    // Size to the container rather than the window, so mobile URL-bar changes don't thrash.
    this.#resizeObserver = new ResizeObserver(() => this.#resize());
    this.#resizeObserver.observe(container);
    this.#resize();

    this.#bindEvents();
    this.#updateScrollTarget();
    this.#progress = this.#targetProgress;
    this.#applyScrollView();
    this.#updateDynamicUniforms();

    // Compile shaders in parallel with the downloads so the first frame doesn't hitch.
    Promise.all([texturesLoaded, this.#renderer.compileAsync(this.#scene, this.#camera)])
      .catch((error: unknown) => console.warn("Shader pre-compilation failed", error))
      .finally(() => {
        if (this.#disposed) return;
        this.#ready = true;
        this.#needsRender = true;
        onReady?.();
      });

    this.#renderer.setAnimationLoop((time) => this.#tick(time));
  }

  /**
   * Swap the preview textures for full resolution. Only done once someone starts exploring and
   * can zoom in, so a normal visit never downloads the large files.
   */
  #loadDetail(): void {
    const loader = new TextureLoader();
    for (const { texture, url } of this.#pendingDetail) {
      loader.load(url, (full) => {
        // Re-uploads the image (and regenerates mipmaps) on the next render.
        texture.image = full.image;
        texture.needsUpdate = true;
        this.#needsRender = true;
      });
    }
    this.#pendingDetail = [];
  }

  /** Toggle free-roam mode where the user drives the camera with orbit controls. */
  setExploring(exploring: boolean): void {
    if (exploring === this.#exploring) return;
    this.#exploring = exploring;
    this.#lastPointer = null;

    if (exploring) {
      this.#loadDetail();
      this.#controls.connect(this.#renderer.domElement);
      this.#controls.enabled = true;
    } else {
      this.#controls.enabled = false;
      this.#controls.disconnect();
      this.#controls.reset();
      this.#focusId = DEFAULT_BODY;
      this.#transition = null;
      this.#zoom = null;
      this.#zoomGoal = null;
      this.#tap = null;
      this.#setDistanceLimits(this.#targets.get(DEFAULT_BODY)!);
      // Leaving explore mode puts the camera back on the Earth.
      this.#onFocusChange?.(DEFAULT_BODY);
      this.#updateScrollTarget();
      this.#progress = this.#targetProgress;
      this.#applyScrollView();
    }
    this.#needsRender = true;
  }

  /** Fly back to the Earth and the starting viewpoint. */
  resetView(): void {
    this.focus(DEFAULT_BODY, new Vector3(0, -1, 0));
    this.#onFocusChange?.(DEFAULT_BODY);
  }

  /** Fly the explore camera to a body and keep following it. */
  focus(id: BodyId, direction: Vector3 | null = null): void {
    const target = this.#targets.get(id);
    if (!target) return;
    const controls = this.#controls;
    const fromDistance = this.#cameraDistance();
    this.#focusId = id;
    this.#zoomGoal = null;
    this.#transition = {
      from: controls.target.clone(),
      fromDistance,
      toDistance: target.viewDistance,
      fromDirection: this.#camera.position.clone().sub(controls.target).normalize(),
      toDirection: direction,
      progress: this.#reducedMotion ? 1 : 0,
    };
    // Allow both the old and new distance while flying, so the controls don't clamp mid-way.
    controls.minDistance = Math.min(controls.minDistance, target.radius * 1.5);
    controls.maxDistance = Math.max(controls.maxDistance, fromDistance, target.viewDistance * 3);
    this.#needsRender = true;
  }

  /** Start zooming while a button is held: +1 in, -1 out. */
  startZoom(direction: 1 | -1): void {
    this.#zoom = { direction, held: 0, from: this.#zoomGoal ?? this.#cameraDistance() };
  }

  /** Stop a held zoom; a quick press zooms exactly one step instead. */
  stopZoom(): void {
    const zoom = this.#zoom;
    this.#zoom = null;
    if (zoom && zoom.held < ZOOM_TAP_SECONDS) {
      this.#zoomGoal = this.#clampDistance(zoom.from * ZOOM_STEP ** zoom.direction);
    }
  }

  /** Zoom one step: +1 in, -1 out. The camera eases there rather than jumping. */
  zoomStep(direction: number): void {
    const from = this.#zoomGoal ?? this.#cameraDistance();
    this.#zoomGoal = this.#clampDistance(from * ZOOM_STEP ** direction);
  }

  dispose(): void {
    this.#disposed = true;
    this.#renderer.setAnimationLoop(null);
    this.#abort.abort();
    this.#resizeObserver.disconnect();
    this.#controls.dispose();

    this.#scene.traverse((object: Object3D) => {
      if (!(object instanceof Mesh || object instanceof Points)) return;
      (object.geometry as BufferGeometry).dispose();
      const materials: Material[] = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials) material.dispose();
    });
    for (const texture of this.#textures) texture.dispose();

    this.#renderer.dispose();
    this.#renderer.forceContextLoss();
    this.#renderer.domElement.remove();
  }

  #createStars(): Points {
    const { positions, colors, sizes } = generateStarfield({
      count: STAR_COUNT,
      radius: STAR_RADIUS,
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("aColor", new BufferAttribute(colors, 3));
    geometry.setAttribute("aSize", new BufferAttribute(sizes, 1));

    // A single draw call for the whole starfield.
    const stars = new Points(geometry, this.#starMaterial);
    stars.frustumCulled = false;
    stars.renderOrder = -1;
    return stars;
  }

  #bindEvents(): void {
    const { signal } = this.#abort;

    window.addEventListener("scroll", () => this.#updateScrollTarget(), { passive: true, signal });
    window.addEventListener("pointermove", (event) => this.#onPointerMove(event), {
      passive: true,
      signal,
    });
    document.documentElement.addEventListener("pointerleave", () => (this.#lastPointer = null), {
      signal,
    });

    // Tap (or click) a planet to fly to it while exploring.
    const canvas = this.#renderer.domElement;
    canvas.addEventListener(
      "pointerdown",
      (event) => {
        // A second finger means pinch, not tap.
        this.#tap =
          this.#exploring && event.isPrimary
            ? { id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp }
            : null;
      },
      { signal },
    );
    canvas.addEventListener(
      "pointerup",
      (event) => {
        const tap = this.#tap;
        this.#tap = null;
        if (!tap || tap.id !== event.pointerId || !this.#exploring) return;
        const moved = Math.hypot(event.clientX - tap.x, event.clientY - tap.y);
        if (moved > TAP_MAX_MOVE || event.timeStamp - tap.time > TAP_MAX_MS) return;
        const id = this.#pick(event.clientX, event.clientY);
        if (id && id !== this.#focusId) {
          this.focus(id);
          this.#onFocusChange?.(id);
        }
      },
      { signal },
    );
    canvas.addEventListener("pointercancel", () => (this.#tap = null), { signal });
    this.#reducedMotionQuery.addEventListener(
      "change",
      (event) => {
        this.#reducedMotion = event.matches;
        if (!this.#exploring) this.#applyScrollView();
        this.#needsRender = true;
      },
      { signal },
    );
  }

  #resize(): void {
    const { clientWidth: width, clientHeight: height } = this.#container;
    if (width === 0 || height === 0) return;

    this.#camera.aspect = width / height;
    this.#camera.updateProjectionMatrix();

    // A wider or narrower view sees more or less of the comet's orbit: re-time it.
    const probe = this.#viewProbe;
    probe.aspect = width / height;
    probe.up.set(0, 0, 1);
    probe.position.set(0, -MIN_DISTANCE, 0);
    probe.lookAt(0, 0, 0);
    probe.updateProjectionMatrix();
    probe.updateMatrixWorld();
    this.#solarSystem.fitCometToView(probe);
    // Comet dust grains are sized in world units, so they need pixels-per-unit at distance 1.
    this.#solarSystem.setPointScale(
      (height * this.#renderer.getPixelRatio()) / (2 * Math.tan(degToRad(this.#camera.fov / 2))),
    );
    this.#renderer.setSize(width, height, false);
    this.#starMaterial.uniforms.uPixelRatio!.value = this.#renderer.getPixelRatio();
    this.#perf = { time: 0, frames: 0 };
    this.#needsRender = true;
  }

  /** Zoom out and orbit the Earth as the page scrolls. */
  #updateScrollTarget(): void {
    const root = document.documentElement;
    this.#targetProgress = scrollProgress(window.scrollY, root.scrollHeight, window.innerHeight);
  }

  /** Subtle parallax: rotate the sky slightly as the mouse moves. */
  #onPointerMove(event: PointerEvent): void {
    if (event.pointerType !== "mouse" || this.#exploring || this.#reducedMotion) return;

    const { clientX: x, clientY: y } = event;
    const last = this.#lastPointer;
    this.#lastPointer = { x, y };
    if (!last) return;

    const dx = x - last.x;
    const dy = y - last.y;
    // Ignore large jumps (e.g. the pointer re-entering the window elsewhere).
    if (Math.abs(dx) < PAN_THRESHOLD)
      this.#parallax.premultiply(this.#turn.setFromAxisAngle(Z_AXIS, degToRad(dx / PAN_SLOWNESS)));
    if (Math.abs(dy) < PAN_THRESHOLD)
      this.#parallax.premultiply(this.#turn.setFromAxisAngle(X_AXIS, degToRad(dy / PAN_SLOWNESS)));
    this.#needsRender = true;
  }

  /**
   * Place the camera for the current scroll progress: further out, swung round the Earth and
   * raised a little. The whole default view is rotated rigidly, so the Earth stays centred and
   * the horizon stays level. Reduced motion keeps the zoom but skips the swing.
   */
  #applyScrollView(): void {
    const progress = this.#progress;
    const turn = this.#reducedMotion ? 0 : progress;
    this.#orbit
      .setFromAxisAngle(Z_AXIS, SCROLL_ORBIT_AZIMUTH * turn)
      .multiply(this.#orbitStep.setFromAxisAngle(X_AXIS, -SCROLL_ORBIT_ELEVATION * turn));
    const distance = lerp(MIN_DISTANCE, MAX_DISTANCE, progress);
    this.#camera.position.set(0, -distance, 0).applyQuaternion(this.#orbit);
    this.#camera.quaternion.multiplyQuaternions(this.#orbit, this.#baseView);
  }

  /** Per-frame uniforms that depend on moving objects. */
  #updateDynamicUniforms(): void {
    this.#moonFrame.updateMatrixWorld(true);
    const moon = this.#moon.getWorldPosition(this.#scratch);
    this.#moonOccluder.value.set(moon.x, moon.y, moon.z, MOON_RADIUS);

    // Clouds drift relative to the ground; shift the cloud-shadow lookup to match.
    this.#earthMaterial.uniforms.uCloudOffset!.value = -this.#clouds.rotation.y / (2 * Math.PI);
  }

  /** Drop the resolution on devices that can't keep up, rather than stuttering. */
  #adaptQuality(delta: number): void {
    const perf = this.#perf;
    perf.time += delta;
    perf.frames++;
    if (perf.time < PERF_SAMPLE_SECONDS) return;

    const fps = perf.frames / perf.time;
    this.#perf = { time: 0, frames: 0 };
    const ratio = this.#renderer.getPixelRatio();
    if (fps < TARGET_FPS && ratio > MIN_PIXEL_RATIO) {
      this.#renderer.setPixelRatio(Math.max(MIN_PIXEL_RATIO, ratio - 0.25));
      this.#resize();
    }
  }

  #setDistanceLimits(target: FocusTarget): void {
    this.#controls.minDistance = target.radius * 1.5;
    this.#controls.maxDistance = Math.max(MAX_DISTANCE, target.viewDistance * 3);
  }

  #cameraDistance(): number {
    return this.#camera.position.distanceTo(this.#controls.target);
  }

  #clampDistance(distance: number): number {
    const { minDistance, maxDistance } = this.#controls;
    return Math.min(maxDistance, Math.max(minDistance, distance));
  }

  #setCameraDistance(distance: number): void {
    const { target } = this.#controls;
    this.#offset.subVectors(this.#camera.position, target).setLength(this.#clampDistance(distance));
    this.#camera.position.copy(target).add(this.#offset);
    this.#needsRender = true;
  }

  /** Fly to / follow the focused body, apply held zoom, then let the orbit controls run. */
  #updateExploreCamera(delta: number): void {
    const controls = this.#controls;
    const target = this.#targets.get(this.#focusId)!;
    const point = target.getPosition(this.#focusPoint);
    const offset = this.#offset.subVectors(this.#camera.position, controls.target);
    const transition = this.#transition;

    if (transition) {
      transition.progress = Math.min(1, transition.progress + delta / FOCUS_SECONDS);
      const k = easeInOutCubic(transition.progress);
      controls.target.lerpVectors(transition.from, point, k);
      // Interpolate distance geometrically so big jumps (Moon to Jupiter) feel even.
      const distance =
        transition.fromDistance * (transition.toDistance / transition.fromDistance) ** k;
      if (transition.toDirection) {
        offset.lerpVectors(transition.fromDirection, transition.toDirection, k);
        if (offset.lengthSq() < 1e-6) offset.copy(transition.toDirection);
      }
      this.#camera.position.copy(controls.target).add(offset.setLength(distance));
      if (transition.progress >= 1) {
        this.#transition = null;
        this.#setDistanceLimits(target);
      }
    } else {
      // Keep the same viewpoint relative to the body as it moves.
      controls.target.copy(point);
      this.#camera.position.copy(point).add(offset);
    }

    // Zoom buttons move a goal distance; the camera eases towards it, so starting, stopping
    // and single steps all glide instead of jumping.
    if (this.#zoom) {
      this.#zoom.held += delta;
      const goal = this.#zoomGoal ?? this.#cameraDistance();
      this.#zoomGoal = this.#clampDistance(
        goal * Math.exp(-this.#zoom.direction * HOLD_ZOOM_RATE * delta),
      );
    }
    if (this.#zoomGoal !== null && !this.#transition) {
      const distance = this.#cameraDistance();
      const remaining = Math.log(this.#zoomGoal / distance);
      // Ease in log space so zooming feels the same near a small moon and a giant planet.
      this.#setCameraDistance(distance * Math.exp(remaining * (1 - Math.exp(-ZOOM_EASE * delta))));
      if (!this.#zoom && Math.abs(remaining) < 1e-3) this.#zoomGoal = null;
    }

    // Damping requires an update every frame; it emits "change" while still moving.
    controls.update(delta);
    this.#needsRender = true;
  }

  /** The body under a screen point, allowing generous slack for ones only a few pixels wide. */
  #pick(clientX: number, clientY: number): BodyId | null {
    const rect = this.#renderer.domElement.getBoundingClientRect();
    const pixelsPerUnit = rect.height / 2 / Math.tan(degToRad(this.#camera.fov / 2));
    let best: { id: BodyId; score: number } | null = null;

    for (const [id, target] of this.#targets) {
      const position = target.getPosition(this.#scratch);
      const distance = position.distanceTo(this.#camera.position);
      const ndc = position.project(this.#camera);
      if (ndc.z < -1 || ndc.z > 1) continue; // behind the camera or past the far plane

      const x = rect.left + ((ndc.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - ndc.y) / 2) * rect.height;
      const reach = Math.max(TAP_MIN_RADIUS, (target.radius / distance) * pixelsPerUnit * 1.15);
      const score = Math.hypot(clientX - x, clientY - y) / reach;
      if (score <= 1 && (!best || score < best.score)) best = { id, score };
    }
    return best?.id ?? null;
  }

  #tick(time: number): void {
    // Clamp delta so returning to a background tab doesn't cause a big jump.
    const delta = this.#lastTime === null ? 0 : Math.min((time - this.#lastTime) / 1000, 0.1);
    this.#lastTime = time;

    if (!this.#reducedMotion) {
      const spin = (degreesPerSecond: number) =>
        degToRad(perFrameAt60(degreesPerSecond / 60, delta));
      this.#drift.premultiply(this.#turn.setFromAxisAngle(SKY_DRIFT_AXIS, spin(SPEED.sky)));
      this.#earth.rotation.y += spin(SPEED.earth);
      this.#clouds.rotation.y += spin(SPEED.clouds);
      this.#moonPivot.rotation.z += spin(SPEED.moonOrbit);
      this.#solarSystem.update(delta);
      this.#needsRender = true;
    }

    // Scroll moves the camera independently of the bodies, so it goes first (the comet's
    // frame below depends on it).
    if (!this.#exploring) {
      const gap = this.#targetProgress - this.#progress;
      if (Math.abs(gap) > 1e-5) {
        this.#progress = this.#reducedMotion
          ? this.#targetProgress
          : this.#progress + gap * (1 - Math.exp(-ZOOM_SMOOTHING * delta));
        this.#applyScrollView();
        this.#needsRender = true;
      }
    }

    // Everything but the Earth turns together, so the Moon, planets and belt stay fixed
    // against the stars. The comet's orbit only follows the mouse (not the drift), so it
    // keeps coming back into view. Done before moving the camera, which may follow a body.
    this.#backdrop.multiplyQuaternions(this.#parallax, this.#drift);
    this.#sky.quaternion.multiplyQuaternions(this.#backdrop, this.#skyBase);
    this.#moonFrame.quaternion.copy(this.#backdrop);
    // The comet's orbit also turns with the scroll orbit, so it stays in the camera's view.
    this.#cometFrame.multiplyQuaternions(this.#orbit, this.#parallax);
    this.#solarSystem.setOrientation(this.#backdrop, this.#cometFrame);

    if (this.#exploring) this.#updateExploreCamera(delta);

    if (!this.#needsRender || !this.#ready) return;
    this.#needsRender = false;

    // The sky is infinitely far away: keep it centred on the camera.
    this.#sky.position.copy(this.#camera.position);
    this.#updateDynamicUniforms();
    this.#renderer.render(this.#scene, this.#camera);

    if (!this.#reducedMotion && delta > 0) this.#adaptQuality(delta);
  }
}

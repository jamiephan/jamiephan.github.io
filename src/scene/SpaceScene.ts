import {
  ACESFilmicToneMapping,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  Euler,
  FrontSide,
  Group,
  ImageBitmapLoader,
  LineSegments,
  LinearFilter,
  LoadingManager,
  MathUtils,
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
  Texture,
  Vector3,
  Vector4,
  WebGLRenderer,
  type Material,
  type Object3D,
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
  createDustStreakMaterial,
  createEarthNightMaterial,
  createEarthMaterial,
  createLightingUniforms,
  createRockyMaterial,
  createSkyMaterial,
  createSpaceDustMaterial,
  createStarMaterial,
  type SpaceDustUniforms,
} from "./materials.ts";
import { degToRad, lerp, perFrameAt60, scrollProgress } from "./math.ts";
import { DEFAULT_BODY, type BodyId } from "./bodies.ts";
import { FlightController, type Obstacle } from "./flight.ts";
import { createSolarSystem, type FocusTarget, type SolarSystem } from "./solarSystem.ts";
import { previewFor } from "./textures.ts";
import { isVRSupported, readVRInput } from "./xr.ts";
import { NEBULA_RANGE, NebulaTexture } from "./nebula.ts";
import { NebulaClouds } from "./nebulaClouds.ts";
import { Galaxies } from "./galaxies.ts";
import { Meteors } from "./meteors.ts";
import { EARTH_RADIUS, SUN_DIRECTION } from "./layout.ts";
import { scrollOrbitFor, type ScrollOrbit } from "./scrollOrbit.ts";
import { PostProcessing } from "./postprocessing.ts";
import { generateStarfield, mulberry32 } from "./stars.ts";

/* ---------- Layout (world units; +Z is "up" on screen, the camera looks along +Y) ---------- */

const MIN_DISTANCE = 25;
const MAX_DISTANCE = 50;

/** Real size ratios (see `layout.ts`); distances are compressed. */
const CLOUD_RADIUS = EARTH_RADIUS * 1.006;
const ATMOSPHERE_RADIUS = EARTH_RADIUS * 1.035;
const EARTH_AXIAL_TILT = degToRad(23.44);
const MOON_RADIUS = EARTH_RADIUS * 0.273;
const MOON_ORBIT_RADIUS = 14;
const MOON_ORBIT_TILT = -0.2;

const SUN_COLOR = new Color(1, 0.96, 0.9).multiplyScalar(1.25);

/** Far enough to see a nebula on the far side of the flight range from the other side. */
const CAMERA_FAR = 8000;

/** The sky sits well beyond the furthest planet (and the camera's far plane covers it). */
const SKY_RADIUS = 1500;
const STAR_RADIUS = 1400;
const STAR_COUNT = 4500;

/** Dust motes in a box of this size (world units) that wraps around the camera. */
const DUST_COUNT = 1800;
const DUST_BOX = 44;
const DUST = {
  boxSize: DUST_BOX,
  /** Grain diameter in world units (exaggerated: real grains are microscopic). */
  size: 0.0175,
  intensity: 0.25,
  /** Slow drift through the solar wind, units per second. */
  drift: new Vector3(0.12, 0.05, -0.03),
  /** Streaks span this many seconds of travel, and fade in between these speeds. */
  streakTime: 0.06,
  streakSpeeds: [15, 60] as [number, number],
};

/** The aurora / thunderstorm shell sits just above the clouds. */
const NIGHT_SHELL_RADIUS = EARTH_RADIUS * 1.012;

/**
 * Exposure adapts like an eye or an auto-exposing camera: darker with the Sun in view,
 * a little brighter facing away from it. Darkening is quicker than recovering.
 */
const EXPOSURE = { base: 1, sunInView: 0.7, awayFromSun: 1.08, darken: 2.5, brighten: 0.8 };
/** The Sun's angular radius (radians), for judging when a body eclipses it. */
const SUN_ANGULAR_RADIUS = 0.012;

/** Camera shake under hard acceleration in flight: units/s² at which it starts and peaks. */
const SHAKE_ACCELERATION: [number, number] = [6, 45];
/** Peak shake, in radians. */
const SHAKE_ANGLE = 0.0035;
/** How often the speedometer is told the speed (ms). */
const SPEED_REPORT_MS = 100;
/** The near plane while flying: a fraction of the gap to the nearest surface, within limits. */
// A fifth of the gap, so layers just above a surface (the Earth's clouds) are never clipped.
const FLIGHT_NEAR = { fraction: 0.2, min: 0.003, max: 0.5 };
const DEFAULT_NEAR = 0.5;

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

/** Adaptive resolution: drop the pixel ratio if we can't hold this frame rate. */
const TARGET_FPS = 45;
const PERF_SAMPLE_SECONDS = 2;
/** Below 1 the 3D background softens, but the page's text and UI (plain HTML) stay sharp. */
const MIN_PIXEL_RATIO = 0.75;
/**
 * Shortest gap between frames of the ambient background (~60 fps, with slack for timer
 * jitter). On 120 Hz+ screens this halves the GPU work. Explore and flight mode run uncapped.
 */
const AMBIENT_FRAME_MS = 1000 / 60 - 2;
/**
 * While the page is visible but not focused (another window in front, or on another screen),
 * nobody is interacting with it: draw ~30 fps whatever the mode. Hidden tabs draw nothing.
 */
const UNFOCUSED_FRAME_MS = 1000 / 30 - 2;

const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);
const Z_AXIS = new Vector3(0, 0, 1);
const SKY_DRIFT_AXIS = new Vector3(0.3, 0.2, 1).normalize();

export interface SpaceSceneOptions {
  /** Called once all textures have loaded, shaders are compiled and the first frame can be shown. */
  onReady?: () => void;
  /** Called when the focused body changes from inside the scene (tapping a planet, resetting). */
  onFocusChange?: (id: BodyId) => void;
  /** Called when a VR session starts or ends. */
  onVRChange?: (inVR: boolean) => void;
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
  /** Procedural nebulae, baked once into a texture the sky shader adds to the Milky Way. */
  readonly #nebula = new NebulaTexture();
  /** Nebulae out in the solar system that the camera can fly through. */
  readonly #nebulaClouds = new NebulaClouds();
  /** Distant galaxies on the backdrop (follow the camera like the sky). */
  readonly #galaxies = new Galaxies();
  readonly #dust: SpaceDustUniforms = {
    uCameraPos: { value: new Vector3() },
    uVelocity: { value: new Vector3() },
    uTime: { value: 0 },
    uPointScale: { value: 1 },
  };
  /** Clock for aurorae, storms and film grain (stands still with reduced motion). */
  readonly #effectsTime = { value: 0 };
  /** 1 to allow flashing effects (storms), 0 with reduced motion. */
  readonly #flashes = { value: 1 };
  readonly #meteors = new Meteors(EARTH_RADIUS);
  #post!: PostProcessing;
  /** The camera's smoothed velocity and acceleration, from how it actually moved. */
  readonly #lastCameraPosition = new Vector3();
  #hasLastCameraPosition = false;
  readonly #cameraVelocity = new Vector3();
  readonly #previousVelocity = new Vector3();
  #acceleration = 0;
  #shake = 0;
  readonly #shakeTurn = new Quaternion();
  readonly #shakeEuler = new Euler();
  readonly #unshaken = new Quaternion();
  /** Adapted exposure, and how visible the Sun is (both eased over time). */
  #exposure = EXPOSURE.base;
  #sunVisibility = 0;
  readonly #sunScreen = new Vector3();
  readonly #forward = new Vector3();
  readonly #speedListeners = new Set<(unitsPerSecond: number) => void>();
  /** Resolves the "nebulae are baked" promise the first time they finish. */
  #bakesDone: (() => void) | null = null;
  #lastSpeedReport = -Infinity;
  readonly #earth: Mesh;
  /** Drawn from its inside faces while the camera flies within it (see `#tick`). */
  readonly #atmosphere: Mesh;
  readonly #clouds: Mesh;
  readonly #cloudMaterial: ShaderMaterial;
  readonly #earthMaterial: ShaderMaterial;
  readonly #moonOrbit = new Group();
  readonly #moonPivot = new Group();
  readonly #moon: Mesh;
  /** The Moon as a shadow-casting sphere, shared by the Earth and cloud shaders. */
  readonly #moonOccluder = { value: new Vector4(0, 0, 0, MOON_RADIUS) };
  readonly #solarSystem: SolarSystem;
  /** The shared sun-direction uniform value; rotating it relights every material at once. */
  readonly #sunDirection: Vector3;

  readonly #scratch = new Vector3();
  /** The camera in its default (non-explore) pose, used to time the comet's orbit. */
  readonly #viewProbe = new PerspectiveCamera(60, 1, 0.5, CAMERA_FAR);
  readonly #focusPoint = new Vector3();
  /** How far the user has panned the orbit centre away from the focused body. */
  readonly #pan = new Vector3();
  readonly #offset = new Vector3();
  /** Everything the explore camera can fly to. */
  readonly #targets = new Map<BodyId, FocusTarget>();
  readonly #onFocusChange: ((id: BodyId) => void) | undefined;
  readonly #onVRChange: ((inVR: boolean) => void) | undefined;
  /**
   * In VR the headset drives its own camera, so it rides in a rig that follows the flight
   * camera (the "ship"); head tracking then moves it around inside.
   */
  readonly #vrRig = new Group();
  readonly #vrCamera = new PerspectiveCamera(60, 1, 0.5, CAMERA_FAR);
  /** Whether this browser can show immersive VR; set once the check resolves. */
  #vrSupported = false;

  #focusId: BodyId = DEFAULT_BODY;
  /** The explore view when flight started, so ending the flight can return to it. */
  #preFlightView: { id: BodyId; direction: Vector3; distance: number } | null = null;
  #transition: FocusTransition | null = null;
  /** A zoom button being held, and the goal distance when it was pressed. */
  #zoom: { direction: number; held: number; from: number } | null = null;
  /** Distance the camera is easing towards after zoom buttons (null when idle). */
  #zoomGoal: number | null = null;
  #tap: { id: number; x: number; y: number; time: number } | null = null;

  #disposed = false;
  #exploring = false;
  /** Free flight (only reachable from explore mode). */
  readonly #flight: FlightController;
  #reducedMotion = this.#reducedMotionQuery.matches;
  /** Scroll progress (0–1) the camera is showing, easing towards the page's actual progress. */
  #progress = 0;
  #targetProgress = 0;
  /** Swing round the Earth driven by scroll; the default camera pose is rotated by this. */
  readonly #orbit = new Quaternion();
  readonly #orbitStep = new Quaternion();
  /**
   * How far the camera has swung round the Earth by the bottom of the page: towards the Sun,
   * which ends up in an upper corner (it depends on the screen's shape; see `scrollOrbit.ts`).
   */
  #scrollOrbit: ScrollOrbit = scrollOrbitFor(16 / 9, 60);
  /** The camera's orientation at the start of the page (looking at the Earth). */
  readonly #baseView = new Quaternion();
  readonly #cometFrame = new Quaternion();
  #lastPointer: { x: number; y: number } | null = null;
  #lastTime: number | null = null;
  #lastRenderTime = -Infinity;
  #needsRender = true;
  #ready = false;
  #focused = document.hasFocus();
  #perf = { time: 0, frames: 0 };

  constructor(
    container: HTMLElement,
    { onReady, onFocusChange, onVRChange }: SpaceSceneOptions = {},
  ) {
    this.#container = container;
    this.#onFocusChange = onFocusChange;
    this.#onVRChange = onVRChange;

    // Renderer — cap DPR at 2; beyond that costs a lot of fill-rate for no visible gain.
    // On screen the canvas only ever receives full-screen post-processing quads, so a
    // multisampled canvas (several bytes per sample per pixel, resolved every frame) would be
    // wasted. WebXR takes its multisampling from this flag, so VR goes without: knowing whether
    // a headset is there means asking `navigator.xr`, which costs every visitor the
    // back/forward cache. That's only done once explore mode starts (see `setExploring`).
    this.#renderer = new WebGLRenderer({
      antialias: false,
      powerPreference: "high-performance",
    });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.toneMapping = ACESFilmicToneMapping;
    this.#renderer.toneMappingExposure = 1;
    // Only takes over rendering while a VR session is running (see `enterVR`).
    this.#renderer.xr.enabled = true;
    // Seated, origin at the head: the cockpit starts exactly where the flight camera is.
    this.#renderer.xr.setReferenceSpaceType("local");
    container.append(this.#renderer.domElement);

    this.#camera = new PerspectiveCamera(60, 1, 0.5, CAMERA_FAR);
    this.#camera.up.set(0, 0, 1);
    this.#camera.position.set(0, -MIN_DISTANCE, 0);
    this.#camera.lookAt(0, 0, 0);
    this.#baseView.copy(this.#camera.quaternion);

    // Textures — fade the canvas in only once they've all arrived.
    let resolveTextures!: () => void;
    const texturesLoaded = new Promise<void>((resolve) => (resolveTextures = resolve));
    const manager = new LoadingManager(resolveTextures);
    manager.onError = (url) => console.warn(`Failed to load texture: ${url}`);
    const loader = this.#createImageLoader(manager);
    const anisotropy = Math.min(8, this.#renderer.capabilities.getMaxAnisotropy());
    const load = (url: string, { color = true, sharp = false, wrap = true } = {}): Texture => {
      // Start with the small preview if there is one; `#loadDetail` fetches the rest later.
      const preview = previewFor(url);
      const texture = new Texture();
      texture.flipY = false; // the loader already flips the bitmap
      loader.load(preview ?? url, (image) => this.#setImage(texture, image));
      if (preview) this.#pendingDetail.push({ texture, url });
      texture.colorSpace = color ? SRGBColorSpace : NoColorSpace;
      if (sharp) texture.anisotropy = anisotropy;
      // Globe maps wrap round in longitude. Clamping would draw a seam where u meets 0/1 (the
      // bump lookups straddle it) and smear the edge column into streaks wherever a lookup is
      // shifted past it (the Earth's cloud shadows, which drift with the clouds).
      if (wrap) texture.wrapS = RepeatWrapping;
      this.#textures.push(texture);
      return texture;
    };

    const lighting = createLightingUniforms(SUN_DIRECTION, SUN_COLOR);
    this.#sunDirection = lighting.uSunDir.value;

    /* ---------- Sky ---------- */
    const milkyWay = load(milkyWayUrl);
    // Magnified everywhere, so mipmaps would only cost memory (and cause a seam at the wrap).
    milkyWay.generateMipmaps = false;
    milkyWay.minFilter = LinearFilter;
    milkyWay.wrapS = RepeatWrapping;

    const skyMesh = new Mesh(
      new SphereGeometry(SKY_RADIUS, 64, 32),
      createSkyMaterial(milkyWay, this.#nebula.texture, NEBULA_RANGE, lighting),
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

    // Aurorae and thunderstorms on the night side, riding with the clouds (and their UVs).
    const nightShell = new Mesh(
      new SphereGeometry(NIGHT_SHELL_RADIUS, 96, 48),
      createEarthNightMaterial(earthTextures.clouds, lighting, this.#effectsTime, this.#flashes),
    );
    nightShell.renderOrder = 1.5;
    this.#clouds.add(nightShell);
    earthTilt.add(this.#earth);

    const atmosphere = (this.#atmosphere = new Mesh(
      new SphereGeometry(ATMOSPHERE_RADIUS, 96, 48),
      createAtmosphereMaterial(lighting, EARTH_RADIUS, ATMOSPHERE_RADIUS),
    ));
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

    /* ---------- Dust drifting between the camera and everything else ---------- */
    const [dust, dustStreaks] = this.#createDust(lighting);

    this.#vrRig.add(this.#vrCamera);
    this.#scene.add(
      this.#sky,
      earthTilt,
      atmosphere,
      this.#moonFrame,
      this.#solarSystem.group,
      this.#nebulaClouds.group,
      this.#galaxies.group,
      this.#meteors.object,
      dust,
      dustStreaks,
      this.#vrRig,
    );

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
    // Right-drag or two fingers pan. The pan is kept as an offset from the focused body (see
    // `#pan`), so the camera keeps following it instead of snapping back.
    this.#controls.screenSpacePanning = true;
    this.#setDistanceLimits(this.#targets.get(DEFAULT_BODY)!);
    this.#controls.saveState();
    this.#controls.addEventListener("change", () => (this.#needsRender = true));
    // Wheel, pinch or drag takes over from any zoom-button easing still in progress.
    this.#controls.addEventListener("start", () => (this.#zoomGoal = null));

    this.#flight = new FlightController(this.#camera, this.#renderer.domElement, () =>
      this.#obstacles(),
    );

    this.#post = new PostProcessing(this.#renderer, this.#scene, this.#camera);

    // Size to the container rather than the window, so mobile URL-bar changes don't thrash.
    this.#resizeObserver = new ResizeObserver(() => this.#resize());
    this.#resizeObserver.observe(container);
    this.#resize();

    this.#bindEvents();
    this.#updateScrollTarget();
    this.#progress = this.#targetProgress;
    this.#applyScrollView();
    this.#updateDynamicUniforms();

    // Compile shaders in parallel with the downloads so the first frame doesn't hitch. They're
    // compiled for the HDR buffer the scene is drawn into (no tone mapping in the materials).
    this.#renderer.setRenderTarget(this.#post.target);
    const compiled = this.#renderer.compileAsync(this.#scene, this.#camera);
    this.#renderer.setRenderTarget(null);
    // The nebulae bake a strip per frame (see `#stepBakes`), so no GPU job runs long.
    const baked = new Promise<void>((resolve) => (this.#bakesDone = resolve));
    Promise.all([texturesLoaded, compiled, baked])
      .catch((error: unknown) => console.warn("Shader pre-compilation failed", error))
      .finally(() => {
        if (this.#disposed) return;
        // Draw one full frame while the canvas is still hidden: this compiles the
        // post-processing shaders, so the first frame anyone sees isn't a slow one.
        this.#renderFrame();
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
    const loader = this.#createImageLoader();
    for (const { texture, url } of this.#pendingDetail) {
      loader.load(url, (image) => this.#setImage(texture, image));
    }
    this.#pendingDetail = [];
  }

  /**
   * Images are decoded to bitmaps off the main thread. Decoding an `<img>` happens during the
   * WebGL upload instead, which blocked the page for hundreds of milliseconds on slower phones.
   */
  #createImageLoader(manager?: LoadingManager): ImageBitmapLoader {
    return new ImageBitmapLoader(manager).setOptions({
      imageOrientation: "flipY",
      premultiplyAlpha: "none",
    });
  }

  /** Give a texture its (new) image; it is uploaded on the next render. */
  #setImage(texture: Texture, image: ImageBitmap): void {
    if (this.#disposed) {
      image.close();
      return;
    }
    const previous = texture.image;
    texture.image = image;
    texture.needsUpdate = true;
    if (previous instanceof ImageBitmap) previous.close();
    this.#needsRender = true;
  }

  /** Toggle free-roam mode where the user drives the camera with orbit controls. */
  setExploring(exploring: boolean): void {
    if (exploring === this.#exploring) return;
    this.#exploring = exploring;
    this.#lastPointer = null;

    if (exploring) {
      // Checked here rather than on load: asking `navigator.xr` rules out the back/forward cache.
      void isVRSupported().then((supported) => (this.#vrSupported = supported));
      this.#loadDetail();
      this.#controls.connect(this.#renderer.domElement);
      this.#controls.enabled = true;
    } else {
      this.exitVR();
      this.#flight.stop();
      this.#preFlightView = null;
      this.#controls.enabled = false;
      this.#controls.disconnect();
      this.#controls.reset();
      this.#focusId = DEFAULT_BODY;
      this.#transition = null;
      this.#zoom = null;
      this.#zoomGoal = null;
      this.#tap = null;
      this.#pan.set(0, 0, 0);
      // The page's lighting is designed around the default Sun.
      this.setSunAngle(0);
      this.#setDistanceLimits(this.#targets.get(DEFAULT_BODY)!);
      // Leaving explore mode puts the camera back on the Earth.
      this.#onFocusChange?.(DEFAULT_BODY);
      this.#updateScrollTarget();
      this.#progress = this.#targetProgress;
      this.#applyScrollView();
    }
    this.#needsRender = true;
  }

  /**
   * Start or stop free flight. Starting takes over the camera where it is; stopping hands it
   * back to the orbit controls and flies back to the body (and viewpoint) it started from.
   */
  setFlying(flying: boolean): void {
    if (!this.#exploring || flying === this.#flight.active) return;
    this.#tap = null;
    this.#zoom = null;
    this.#zoomGoal = null;
    this.#transition = null;
    if (flying) {
      this.#loadDetail();
      this.#controls.enabled = false;
      this.#preFlightView = {
        id: this.#focusId,
        direction: this.#offset
          .subVectors(this.#camera.position, this.#controls.target)
          .normalize()
          .clone(),
        distance: this.#cameraDistance(),
      };
      // Leave the mouse free where VR is available, so "Enter VR" can be clicked.
      this.#flight.start({ lockPointer: !this.#vrSupported });
    } else {
      this.exitVR();
      this.#flight.stop();
      this.#setNear(DEFAULT_NEAR);
      // Orbit round a point just ahead, so the hand-over doesn't jump, then fly back.
      this.#flight.pointAhead(10, this.#controls.target);
      this.#controls.enabled = true;
      const view = this.#preFlightView;
      this.#preFlightView = null;
      if (view) {
        this.focus(view.id, view.direction, view.distance);
        this.#onFocusChange?.(view.id);
      } else {
        this.resetView();
      }
    }
    this.#needsRender = true;
  }

  /**
   * Put on the headset: fly in immersive VR, starting from the current flight view. Must be
   * called from a click or tap. Does nothing outside flight mode or where VR isn't available.
   */
  async enterVR(): Promise<void> {
    const xr = this.#renderer.xr;
    if (!this.#flight.active || xr.isPresenting || !navigator.xr) return;
    const session = await navigator.xr.requestSession("immersive-vr");
    // The flight may have ended while the browser was asking for permission.
    if (this.#disposed || !this.#flight.active) {
      await session.end();
      return;
    }
    session.addEventListener("end", () => {
      this.#flight.setVR(false);
      this.#needsRender = true;
      this.#onVRChange?.(false);
    });
    await xr.setSession(session);
    this.#flight.setVR(true);
    this.#onVRChange?.(true);
  }

  /** Take the headset off: end any VR session (flight carries on on the screen). */
  exitVR(): void {
    void this.#renderer.xr.getSession()?.end();
  }

  /** On-screen roll buttons (touch devices). */
  setRoll(direction: -1 | 1, on: boolean): void {
    this.#flight.setRoll(direction, on);
  }

  /** Bodies to steer round while flying (the comet is just gas and dust). */
  *#obstacles(): Iterable<Obstacle> {
    for (const [id, target] of this.#targets) if (id !== "comet") yield target;
  }

  /**
   * Move the Sun round the solar system: degrees about the vertical axis from its default
   * position, keeping its height. Lighting, shadows, the sky glow and comet tails all follow.
   */
  setSunAngle(degrees: number): void {
    this.#sunDirection.copy(SUN_DIRECTION).applyAxisAngle(Z_AXIS, degToRad(degrees));
    this.#needsRender = true;
  }

  /** Fly back to the Earth and the starting viewpoint. */
  resetView(): void {
    this.focus(DEFAULT_BODY, new Vector3(0, -1, 0));
    this.#onFocusChange?.(DEFAULT_BODY);
  }

  /**
   * Fly the explore camera to a body and keep following it, optionally ending up looking from
   * `direction` at `distance` (by default, the body's usual viewing distance).
   */
  focus(id: BodyId, direction: Vector3 | null = null, distance?: number): void {
    const target = this.#targets.get(id);
    if (!target) return;
    const controls = this.#controls;
    const fromDistance = this.#cameraDistance();
    const toDistance = distance ?? target.viewDistance;
    this.#focusId = id;
    this.#zoomGoal = null;
    // Flying to a body centres it again.
    this.#pan.set(0, 0, 0);
    this.#transition = {
      from: controls.target.clone(),
      fromDistance,
      toDistance,
      fromDirection: this.#camera.position.clone().sub(controls.target).normalize(),
      toDirection: direction,
      progress: this.#reducedMotion ? 1 : 0,
    };
    // Allow both the old and new distance while flying, so the controls don't clamp mid-way.
    controls.minDistance = Math.min(controls.minDistance, target.radius * 1.5);
    controls.maxDistance = Math.max(
      controls.maxDistance,
      fromDistance,
      toDistance,
      target.viewDistance * 3,
    );
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
    this.exitVR();
    this.#renderer.setAnimationLoop(null);
    this.#abort.abort();
    this.#resizeObserver.disconnect();
    this.#flight.stop();
    this.#controls.dispose();

    this.#scene.traverse((object: Object3D) => {
      if (!(object instanceof Mesh || object instanceof Points)) return;
      (object.geometry as BufferGeometry).dispose();
      const materials: Material[] = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials) material.dispose();
    });
    for (const texture of this.#textures) {
      texture.dispose();
      if (texture.image instanceof ImageBitmap) texture.image.close();
    }
    this.#nebula.dispose();
    this.#nebulaClouds.dispose();
    this.#post.dispose();

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

  #createDust(lighting: ReturnType<typeof createLightingUniforms>): [Points, LineSegments] {
    const random = mulberry32(2718);
    const positions = new Float32Array(DUST_COUNT * 3);
    const randoms = new Float32Array(DUST_COUNT * 2);
    for (let i = 0; i < positions.length; i++) positions[i] = random();
    for (let i = 0; i < randoms.length; i++) randoms[i] = random();
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("aRandom", new BufferAttribute(randoms, 2));

    const earth = { value: new Vector4(0, 0, 0, EARTH_RADIUS) };
    const dust = new Points(geometry, createSpaceDustMaterial(this.#dust, lighting, DUST, earth));
    // Positions are wrapped around the camera in the shader, so the bounds mean nothing.
    dust.frustumCulled = false;

    // The same grains again as head/tail pairs, for streaks at speed.
    const pairs = new Float32Array(DUST_COUNT * 6);
    const pairRandoms = new Float32Array(DUST_COUNT * 4);
    const ends = new Float32Array(DUST_COUNT * 2);
    for (let i = 0; i < DUST_COUNT; i++) {
      for (const end of [0, 1]) {
        const v = i * 2 + end;
        pairs.set(positions.subarray(i * 3, i * 3 + 3), v * 3);
        pairRandoms.set(randoms.subarray(i * 2, i * 2 + 2), v * 2);
        ends[v] = end;
      }
    }
    const streakGeometry = new BufferGeometry();
    streakGeometry.setAttribute("position", new BufferAttribute(pairs, 3));
    streakGeometry.setAttribute("aRandom", new BufferAttribute(pairRandoms, 2));
    streakGeometry.setAttribute("aEnd", new BufferAttribute(ends, 1));
    const streaks = new LineSegments(
      streakGeometry,
      createDustStreakMaterial(this.#dust, lighting, DUST, earth),
    );
    streaks.frustumCulled = false;
    return [dust, streaks];
  }

  /**
   * Call `listener` with the flight speed (world units per second) a few times a second while
   * flying. Returns a function that unsubscribes.
   */
  subscribeSpeed(listener: (unitsPerSecond: number) => void): () => void {
    this.#speedListeners.add(listener);
    return () => this.#speedListeners.delete(listener);
  }

  #setNear(near: number): void {
    if (Math.abs(near - this.#camera.near) < 1e-4) return;
    this.#camera.near = near;
    this.#camera.updateProjectionMatrix();
  }

  /** Velocity and acceleration from how the camera actually moved, smoothed. */
  #trackMotion(delta: number): void {
    const position = this.#camera.position;
    if (!this.#hasLastCameraPosition || delta <= 0) {
      this.#lastCameraPosition.copy(position);
      this.#hasLastCameraPosition = true;
      return;
    }
    const step = this.#scratch.subVectors(position, this.#lastCameraPosition).divideScalar(delta);
    this.#lastCameraPosition.copy(position);
    // A jump (resetting the view, a big transition) isn't motion.
    if (step.length() > 600 || this.#reducedMotion) step.set(0, 0, 0);

    this.#previousVelocity.copy(this.#cameraVelocity);
    this.#cameraVelocity.lerp(step, 1 - Math.exp(-12 * delta));
    const acceleration = this.#previousVelocity.distanceTo(this.#cameraVelocity) / delta;
    this.#acceleration = lerp(this.#acceleration, acceleration, 1 - Math.exp(-8 * delta));
    this.#dust.uVelocity.value.copy(this.#cameraVelocity);
  }

  /**
   * Where the Sun is on screen and how much of it shows (not behind the camera, nor eclipsed
   * by a body), then the exposure the "eye" adapts towards. Eased, so nothing pops.
   */
  #updateSunAndExposure(delta: number): void {
    const camera = this.#camera;
    const sun = this.#sunDirection;
    const forward = camera.getWorldDirection(this.#forward);
    const facing = forward.dot(sun);

    let visible = 0;
    let x = 0.5;
    let y = 0.5;
    if (facing > 0) {
      const ndc = this.#sunScreen.copy(camera.position).addScaledVector(sun, 1000).project(camera);
      x = (ndc.x + 1) / 2;
      y = (ndc.y + 1) / 2;
      const edge = Math.max(Math.abs(ndc.x), Math.abs(ndc.y));
      visible = 1 - MathUtils.smoothstep(edge, 0.95, 1.5);
      // Eclipsed (fully or partly) by any body between the camera and the Sun.
      for (const target of this.#obstacles()) {
        const toBody = target.getPosition(this.#scratch).sub(camera.position);
        const along = toBody.dot(sun);
        if (along <= 0) continue;
        const miss = toBody.addScaledVector(sun, -along).length() - target.radius;
        const sunRadius = along * SUN_ANGULAR_RADIUS;
        visible *= MathUtils.smoothstep(miss, -sunRadius, sunRadius);
      }
    }
    const ease = 1 - Math.exp(-10 * delta);
    this.#sunVisibility = delta > 0 ? lerp(this.#sunVisibility, visible, ease) : visible;
    this.#post.setSun(x, y, this.#sunVisibility);

    const glare = this.#sunVisibility * MathUtils.smoothstep(facing, 0.3, 1);
    const away = MathUtils.smoothstep(-facing, 0.2, 0.9);
    const target =
      lerp(EXPOSURE.base, EXPOSURE.sunInView, glare) * lerp(1, EXPOSURE.awayFromSun, away);
    const rate = target < this.#exposure ? EXPOSURE.darken : EXPOSURE.brighten;
    this.#exposure = delta > 0 ? lerp(this.#exposure, target, 1 - Math.exp(-rate * delta)) : target;
    if (Math.abs(this.#exposure - target) > 0.002) this.#needsRender = true;
    this.#renderer.toneMappingExposure = this.#exposure;
  }

  /** A slight, fast shudder under hard acceleration in flight (never in VR or reduced motion). */
  #applyShake(time: number): boolean {
    const [start, peak] = SHAKE_ACCELERATION;
    const target =
      this.#flight.active && !this.#reducedMotion
        ? MathUtils.smoothstep(this.#acceleration, start, peak)
        : 0;
    this.#shake = Math.max(target, this.#shake * 0.9);
    if (this.#shake < 0.01) return false;
    const t = time / 1000;
    const amount = SHAKE_ANGLE * this.#shake;
    this.#unshaken.copy(this.#camera.quaternion);
    this.#shakeTurn.setFromEuler(
      this.#shakeEuler.set(
        amount * (Math.sin(t * 37) + 0.6 * Math.sin(t * 23.3 + 1)),
        amount * (Math.sin(t * 31.7 + 2) + 0.6 * Math.sin(t * 19.1)),
        amount * 0.5 * Math.sin(t * 27.9 + 4),
      ),
    );
    this.#camera.quaternion.multiply(this.#shakeTurn);
    return true;
  }

  #bindEvents(): void {
    const { signal } = this.#abort;

    // A lost context loses the baked nebulae with it; three.js restores everything else.
    this.#renderer.domElement.addEventListener(
      "webglcontextrestored",
      () => {
        this.#nebula.bake.restart();
        this.#nebulaClouds.bake.restart();
        this.#needsRender = true;
      },
      { signal },
    );

    const onFocusChange = (): void => {
      this.#focused = document.hasFocus();
      // Frame times measured at the other rate say nothing about this one.
      this.#perf = { time: 0, frames: 0 };
      this.#lastRenderTime = -Infinity;
      this.#needsRender = true;
    };
    window.addEventListener("focus", onFocusChange, { signal });
    window.addEventListener("blur", onFocusChange, { signal });

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
          this.#exploring && !this.#flight.active && event.isPrimary
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
        // Tapping the focused body again re-centres it after panning.
        if (id && (id !== this.#focusId || this.#pan.lengthSq() > 0)) {
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
    // The headset sets its own size while presenting; the canvas is resized when it ends.
    if (this.#renderer.xr.isPresenting) return;
    const { clientWidth: width, clientHeight: height } = this.#container;
    if (width === 0 || height === 0) return;

    this.#camera.aspect = width / height;
    this.#camera.updateProjectionMatrix();
    this.#scrollOrbit = scrollOrbitFor(this.#camera.aspect, this.#camera.fov);
    if (!this.#exploring) this.#applyScrollView();

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
    this.#post.setSize(width, height, this.#renderer.getPixelRatio());
    this.#starMaterial.uniforms.uPixelRatio!.value = this.#renderer.getPixelRatio();
    this.#dust.uPointScale.value =
      (height * this.#renderer.getPixelRatio()) / (2 * Math.tan(degToRad(this.#camera.fov / 2)));
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
      .setFromAxisAngle(Z_AXIS, this.#scrollOrbit.azimuth * turn)
      .multiply(this.#orbitStep.setFromAxisAngle(X_AXIS, -this.#scrollOrbit.elevation * turn));
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
    // Kept within 0–1 (the texture repeats), so precision doesn't drain away as it grows.
    this.#earthMaterial.uniforms.uCloudOffset!.value = MathUtils.euclideanModulo(
      -this.#clouds.rotation.y / (2 * Math.PI),
      1,
    );
  }

  /**
   * Drop the resolution on devices that can't keep up, rather than stuttering. Measures the
   * time between rendered frames, not between ticks: on high-refresh screens the ambient view
   * skips ticks, and counting only the rendered ticks' deltas would overstate the frame rate.
   */
  #adaptQuality(interval: number): void {
    // A gap this long is a pause (hidden tab, nothing to draw), not a slow frame.
    if (interval <= 0 || interval > 0.25) return;
    const perf = this.#perf;
    perf.time += interval;
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
      // Keep the same viewpoint relative to the body (plus any pan) as it moves.
      controls.target.copy(point).add(this.#pan);
      this.#camera.position.copy(controls.target).add(offset);
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
    // Remember where panning left the orbit centre relative to the body.
    if (!this.#transition) this.#pan.subVectors(controls.target, point);
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

  /** Bake one strip of whichever nebula texture isn't finished yet. */
  #stepBakes(): void {
    const bakes = [this.#nebula.bake, this.#nebulaClouds.bake];
    // Compile every bake's shader up front, in parallel; each only starts once it's ready.
    for (const bake of bakes) bake.prepare(this.#renderer);
    const bake = bakes.find((b) => !b.done);
    if (!bake) {
      this.#bakesDone?.();
      this.#bakesDone = null;
      return;
    }
    bake.step(this.#renderer);
    this.#needsRender = true;
  }

  /** Draw the scene: straight to the headset in VR, otherwise through post-processing. */
  #renderFrame(time = 0): void {
    // Inside the atmosphere its outer faces point away from the camera; draw the inner ones.
    // (The shader marches from the camera either way, so the result is the same.)
    (this.#atmosphere.material as Material).side =
      this.#camera.position.length() < ATMOSPHERE_RADIUS ? BackSide : FrontSide;
    // The sky is infinitely far away: keep it centred on the camera.
    this.#sky.position.copy(this.#camera.position);
    this.#galaxies.group.position.copy(this.#camera.position);
    this.#dust.uCameraPos.value.copy(this.#camera.position);
    this.#updateDynamicUniforms();
    if (this.#renderer.xr.isPresenting) {
      this.#renderer.render(this.#scene, this.#vrCamera);
      return;
    }
    const shaken = this.#applyShake(time);
    this.#post.setTime(this.#effectsTime.value);
    this.#post.render();
    if (shaken) {
      this.#camera.quaternion.copy(this.#unshaken);
      // Keep rendering while a shake settles.
      this.#needsRender = true;
    }
  }

  #tick(time: number): void {
    this.#stepBakes();
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
      this.#dust.uTime.value += delta;
      this.#nebulaClouds.update(delta);
      this.#effectsTime.value += delta;
      this.#meteors.update(delta);
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

    // The sky, the Moon's orbit and the far-off nebulae and galaxies drift together. The planets
    // and belt only follow the mouse: drifting would carry them round the Earth while the Sun
    // stays put, scrambling their order from it (and moving them under a flying ship). The
    // comet's orbit doesn't drift either, so it keeps coming back into view. Done before moving
    // the camera, which may follow a body.
    this.#backdrop.multiplyQuaternions(this.#parallax, this.#drift);
    this.#sky.quaternion.multiplyQuaternions(this.#backdrop, this.#skyBase);
    this.#moonFrame.quaternion.copy(this.#backdrop);
    this.#nebulaClouds.group.quaternion.copy(this.#backdrop);
    this.#galaxies.group.quaternion.copy(this.#backdrop);
    // The comet's orbit also turns with the scroll orbit, so it stays in the camera's view.
    this.#cometFrame.multiplyQuaternions(this.#orbit, this.#parallax);
    this.#solarSystem.setOrientation(this.#parallax, this.#cometFrame);

    const vr = this.#renderer.xr.isPresenting;
    if (this.#flight.active) {
      const session = vr ? this.#renderer.xr.getSession() : null;
      // The headset's pose relative to the ship is last frame's: close enough to steer by.
      if (session)
        this.#flight.setVRInput(readVRInput(session.inputSources), this.#vrCamera.quaternion);
      this.#flight.update(delta);
      // Let the camera get close to surfaces without slicing them.
      const { fraction, min, max } = FLIGHT_NEAR;
      this.#setNear(MathUtils.clamp(this.#flight.nearestGap * fraction, min, max));
      this.#needsRender = true;
      if (time - this.#lastSpeedReport > SPEED_REPORT_MS) {
        this.#lastSpeedReport = time;
        for (const listener of this.#speedListeners) listener(this.#flight.speed);
      }
    } else if (this.#exploring) {
      this.#updateExploreCamera(delta);
    }

    this.#trackMotion(delta);
    this.#flashes.value = this.#reducedMotion ? 0 : 1;
    this.#updateSunAndExposure(delta);

    // A headset needs a new frame every time, for every movement of the head.
    if (vr) this.#needsRender = true;
    if (!this.#needsRender || !this.#ready) return;
    // The headset sets its own pace (and the page may well lose focus while it's on).
    const throttled = !vr && !this.#focused;
    const minGap = throttled ? UNFOCUSED_FRAME_MS : this.#exploring ? 0 : AMBIENT_FRAME_MS;
    if (time - this.#lastRenderTime < minGap) return;
    this.#needsRender = false;
    const interval = (time - this.#lastRenderTime) / 1000;
    this.#lastRenderTime = time;

    // In VR, the rig carries the headset along with the ship.
    if (vr) this.#vrRig.position.copy(this.#camera.position);
    if (vr) this.#vrRig.quaternion.copy(this.#camera.quaternion);
    this.#renderFrame(time);

    // The headset's frame rate and resolution aren't the page's to change.
    // Throttled frames are slow on purpose, not because the GPU can't keep up.
    if (!vr && !throttled && !this.#reducedMotion) this.#adaptQuality(interval);
  }
}

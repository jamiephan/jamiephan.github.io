/**
 * Meteors: every few seconds a speck of debris burns up in the Earth's upper atmosphere, a
 * short bright streak skimming across the globe. The head is brighter than white, so bloom
 * gives it a glow; the tail fades to nothing (black adds nothing with additive blending).
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  LineBasicMaterial,
  LineSegments,
  Vector3,
} from "three";

interface Meteor {
  /** Seconds since it started burning; negative while idle. */
  age: number;
  life: number;
  start: Vector3;
  velocity: Vector3;
  brightness: number;
}

const POOL = 6;
/** Average seconds between meteors. */
const MEAN_GAP = 2.5;
/** Seconds of travel the visible trail spans. */
const TRAIL = 0.18;
const HEAD_COLOR = new Vector3(1.6, 2.0, 1.7);

export class Meteors {
  readonly object: LineSegments;
  readonly #meteors: Meteor[];
  readonly #positions = new Float32Array(POOL * 6);
  readonly #colors = new Float32Array(POOL * 6);
  readonly #radius: number;
  #untilNext = 1;
  readonly #head = new Vector3();
  readonly #tail = new Vector3();

  /** `radius` is the Earth's: meteors burn a little above it. */
  constructor(radius: number) {
    this.#radius = radius;
    this.#meteors = Array.from({ length: POOL }, () => ({
      age: -1,
      life: 1,
      start: new Vector3(),
      velocity: new Vector3(),
      brightness: 1,
    }));
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(this.#positions, 3));
    geometry.setAttribute("color", new BufferAttribute(this.#colors, 3));
    this.object = new LineSegments(
      geometry,
      new LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    this.object.frustumCulled = false;
  }

  update(delta: number): void {
    this.#untilNext -= delta;
    if (this.#untilNext <= 0) {
      this.#untilNext = -Math.log(Math.max(Math.random(), 1e-3)) * MEAN_GAP;
      const idle = this.#meteors.find((meteor) => meteor.age < 0);
      if (idle) this.#spawn(idle);
    }

    for (const [i, meteor] of this.#meteors.entries()) {
      let glow = 0;
      if (meteor.age >= 0) {
        meteor.age += delta;
        if (meteor.age > meteor.life) meteor.age = -1;
        else {
          const t = meteor.age / meteor.life;
          // Flares up quickly, then burns out.
          glow = meteor.brightness * Math.sin(Math.PI * Math.min(1, t * 1.6) ** 0.7) * (1 - t);
        }
      }
      if (glow <= 0) {
        this.#colors.fill(0, i * 6, i * 6 + 6);
        continue;
      }
      this.#head.copy(meteor.start).addScaledVector(meteor.velocity, meteor.age);
      this.#tail
        .copy(meteor.start)
        .addScaledVector(meteor.velocity, Math.max(0, meteor.age - TRAIL));
      this.#positions.set([...this.#head.toArray(), ...this.#tail.toArray()], i * 6);
      this.#colors.set(
        [HEAD_COLOR.x * glow, HEAD_COLOR.y * glow, HEAD_COLOR.z * glow, 0, 0, 0],
        i * 6,
      );
    }
    this.object.geometry.getAttribute("position").needsUpdate = true;
    this.object.geometry.getAttribute("color").needsUpdate = true;
  }

  /** A random point ~100 km up, moving mostly sideways and slightly down. */
  #spawn(meteor: Meteor): void {
    const up = new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
    up.normalize();
    meteor.start.copy(up).multiplyScalar(this.#radius * 1.022);
    const sideways = new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
      .projectOnPlane(up)
      .normalize();
    const speed = this.#radius * (0.12 + 0.12 * Math.random());
    meteor.velocity
      .copy(sideways)
      .multiplyScalar(speed)
      .addScaledVector(up, -speed * 0.12);
    meteor.life = 0.5 + 0.6 * Math.random();
    meteor.brightness = 0.5 + Math.random();
    meteor.age = 0;
  }
}

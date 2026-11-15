/**
 * Camera-like post-processing, so the scene reads as photographed rather than drawn:
 *
 * 1. The scene renders into an HDR buffer (materials skip tone mapping when drawing off-screen).
 * 2. Lens flare: ghosts and a soft streak when the Sun is in or near the frame. This pass also
 *    scrubs invalid pixels (NaN, infinite or negative) before bloom: the 8-bit canvas used to
 *    hide them, but bloom's blur would smear a single one into a big black box.
 * 3. Bloom: very bright things (the Sun, glints, meteor heads) bleed light into their
 *    surroundings, as they do in a lens and in the eye.
 * 4. Tone mapping with the renderer's exposure (which the scene adapts, like an eye).
 * 5. A whisper of film grain, which also dithers away banding in dark gradients.
 *
 * Not used in VR: WebXR renders straight to the headset.
 */
import { HalfFloatType, Vector2, WebGLRenderTarget, type Camera, type Scene } from "three";
import type { WebGLRenderer } from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

const BLOOM = { strength: 0.32, radius: 0.55, threshold: 1.1 };

const LensFlareShader = {
  uniforms: {
    tDiffuse: { value: null },
    /** Sun position in UV space (may be off-screen). */
    uSunPos: { value: new Vector2(0.5, 0.5) },
    /** 0–1: how much of the Sun is visible (in front of the camera and not eclipsed). */
    uVisibility: { value: 0 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uSunPos;
    uniform float uVisibility;
    uniform float uAspect;
    varying vec2 vUv;

    // A soft-edged disc of radius r around p (aspect-corrected).
    float disc(vec2 p, float r, float softness) {
      vec2 d = vUv - p;
      d.x *= uAspect;
      return smoothstep(r, r * (1.0 - softness), length(d));
    }

    void main() {
      vec3 color = texture2D(tDiffuse, vUv).rgb;
      // NaN fails every comparison, so this zeroes it; infinities and negatives are clamped.
      bvec3 valid = bvec3(color.r == color.r, color.g == color.g, color.b == color.b);
      color = clamp(mix(vec3(0.0), color, vec3(valid)), 0.0, 6.0e4);
      if (any(isnan(color)) || any(isinf(color))) color = vec3(0.0);
      if (uVisibility > 0.001) {
        vec2 toSun = vUv - uSunPos;
        toSun.x *= uAspect;
        float dist = length(toSun);
        vec3 flare = vec3(0.0);

        // A thin horizontal streak through the Sun, as from a camera's lens coatings.
        flare += vec3(0.75, 0.85, 1.0) * exp(-abs(toSun.y) * 260.0) * exp(-abs(toSun.x) * 3.5) * 0.18;
        // A faint wide halo ring.
        flare += vec3(0.5, 0.7, 1.0) * exp(-pow((dist - 0.42) * 22.0, 2.0)) * 0.025;

        // Ghosts: reflections between lens elements, along the line through the centre.
        vec2 axis = vec2(0.5) - uSunPos;
        flare += vec3(1.0, 0.6, 0.3) * disc(uSunPos + axis * 0.55, 0.035, 0.5) * 0.05;
        flare += vec3(0.4, 1.0, 0.6) * disc(uSunPos + axis * 1.25, 0.07, 0.3) * 0.03;
        flare += vec3(0.4, 0.6, 1.0) * disc(uSunPos + axis * 1.6, 0.11, 0.6) * 0.025;
        flare += vec3(0.8, 0.5, 1.0) * disc(uSunPos + axis * 2.1, 0.05, 0.4) * 0.04;
        flare += vec3(1.0, 0.85, 0.6) * disc(uSunPos + axis * 2.6, 0.16, 0.8) * 0.015;

        color += flare * uVisibility;
      }
      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

const GrainShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAmount: { value: 0.022 },
  },
  vertexShader: LensFlareShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAmount;
    varying vec2 vUv;

    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec3 color = texture2D(tDiffuse, vUv).rgb;
      // Triangular noise (sum of two uniforms) dithers more evenly than a single sample.
      vec2 p = gl_FragCoord.xy + fract(uTime * 7.31) * 517.0;
      float noise = hash(p) + hash(p + 71.3) - 1.0;
      // Film grain shows most in the mid-tones and darks, little in highlights.
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color += noise * uAmount * (1.0 - 0.7 * luma);
      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

export class PostProcessing {
  readonly #composer: EffectComposer;
  readonly #bloom: UnrealBloomPass;
  readonly #flare: ShaderPass;
  readonly #grain: ShaderPass;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: Camera) {
    // HDR, multisampled like the canvas would be.
    const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
    this.#composer = new EffectComposer(renderer, target);
    this.#composer.addPass(new RenderPass(scene, camera));
    // Before bloom: it scrubs invalid pixels (see above), and the flare's ghosts glow too.
    this.#flare = new ShaderPass(LensFlareShader);
    this.#composer.addPass(this.#flare);
    this.#bloom = new UnrealBloomPass(
      new Vector2(1, 1),
      BLOOM.strength,
      BLOOM.radius,
      BLOOM.threshold,
    );
    this.#composer.addPass(this.#bloom);
    this.#composer.addPass(new OutputPass());
    this.#grain = new ShaderPass(GrainShader);
    this.#composer.addPass(this.#grain);
  }

  /** The HDR buffer the scene is drawn into, for pre-compiling shaders against. */
  get target(): WebGLRenderTarget {
    return this.#composer.readBuffer;
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.#composer.setPixelRatio(pixelRatio);
    this.#composer.setSize(width, height);
    this.#flare.uniforms.uAspect!.value = width / height;
  }

  /** Where the Sun is on screen (UV, may be outside 0–1) and how visible it is (0–1). */
  setSun(x: number, y: number, visibility: number): void {
    (this.#flare.uniforms.uSunPos!.value as Vector2).set(x, y);
    this.#flare.uniforms.uVisibility!.value = visibility;
  }

  setTime(seconds: number): void {
    this.#grain.uniforms.uTime!.value = seconds;
  }

  render(): void {
    this.#composer.render();
  }

  dispose(): void {
    this.#composer.dispose();
    this.#bloom.dispose();
  }
}

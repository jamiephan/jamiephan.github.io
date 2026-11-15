/**
 * Camera-like post-processing, so the scene reads as photographed rather than drawn:
 *
 * 1. The scene renders into an HDR buffer (materials skip tone mapping when drawing off-screen).
 * 2. Lens flare: ghosts and a soft streak when the Sun is in or near the frame. This pass also
 *    scrubs invalid pixels (NaN, infinite or negative) before bloom: the 8-bit canvas used to
 *    hide them, but bloom's blur would smear a single one into a big black box.
 * 3. Bloom: very bright things (the Sun, glints, meteor heads) bleed light into their
 *    surroundings, as they do in a lens and in the eye.
 * 4. Tone mapping with the renderer's exposure (which the scene adapts, like an eye), plus a
 *    whisper of film grain (which also dithers away banding in dark gradients) in the same pass.
 *
 * Only the scene pass is multisampled; the full-screen passes after it gain nothing from MSAA.
 *
 * Not used in VR: WebXR renders straight to the headset.
 */
import { HalfFloatType, Vector2, WebGLRenderTarget, type Camera, type Scene } from "three";
import type { WebGLRenderer } from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputShader } from "three/addons/shaders/OutputShader.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { GRAIN, GRAIN_PARS } from "./shaders/chunks.ts";
import lensFlareVert from "./shaders/lensFlare.vert.glsl?raw";
import lensFlareFrag from "./shaders/lensFlare.frag.glsl?raw";

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
  vertexShader: lensFlareVert,
  fragmentShader: lensFlareFrag,
};

/** Three's output pass (tone mapping + colour space) with the grain folded in: one pass, not two. */
class GrainOutputPass extends OutputPass {
  constructor() {
    super();
    const material = this.material;
    const fragment = OutputShader.fragmentShader;
    const main = fragment.indexOf("void main()");
    const end = fragment.lastIndexOf("}");
    if (main < 0 || end < main) throw new Error("Unexpected OutputShader source");
    material.fragmentShader =
      fragment.slice(0, main) + GRAIN_PARS + fragment.slice(main, end) + GRAIN + "}";
    // The material shares this object, so these reach the shader.
    this.uniforms.uTime = { value: 0 };
    this.uniforms.uGrain = { value: 0.022 };
    material.needsUpdate = true;
  }
}

export class PostProcessing {
  readonly #composer: EffectComposer;
  readonly #bloom: UnrealBloomPass;
  readonly #flare: ShaderPass;
  readonly #output: GrainOutputPass;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: Camera) {
    // HDR, multisampled like the canvas would be.
    const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
    this.#composer = new EffectComposer(renderer, target);
    // The composer clones the target for its second buffer; only the scene needs MSAA, so
    // drop it there (nothing has been allocated yet). The scene pass draws into the first
    // every frame only while an EVEN number of passes swap buffers (now: flare and output).
    // Adding or removing a swapping pass would leave the scene aliased on alternate frames.
    this.#composer.renderTarget2.samples = 0;
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
    this.#output = new GrainOutputPass();
    this.#composer.addPass(this.#output);
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
    this.#output.uniforms.uTime!.value = seconds;
  }

  render(): void {
    this.#composer.render();
  }

  dispose(): void {
    this.#composer.dispose();
    this.#bloom.dispose();
  }
}

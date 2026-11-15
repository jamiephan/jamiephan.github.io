/**
 * GLSL snippets shared between shaders. Each shader file in this folder holds only its own
 * code; the TypeScript that builds the material puts the chunks it needs in front with `glsl`.
 */
import commonGlsl from "./chunks/common.glsl?raw";
import dustVertexGlsl from "./chunks/dustVertex.glsl?raw";
import grainGlsl from "./chunks/grain.glsl?raw";
import grainParsGlsl from "./chunks/grainPars.glsl?raw";
import noiseGlsl from "./chunks/noise.glsl?raw";
import rimGlsl from "./chunks/rim.glsl?raw";
import sphereVaryingsGlsl from "./chunks/sphereVaryings.glsl?raw";

/** Joins GLSL sources in order (chunks first, then the shader's own code). */
export const glsl = (...parts: string[]): string => parts.join("\n");

/** `PI`, ray–sphere intersection, analytic sphere shadows, normal perturbation, luminance. */
export const COMMON = commonGlsl;
/** Value noise and 6-octave fBm in [0, 1]. */
export const NOISE = noiseGlsl;
/** Thin-atmosphere glow at the limb of the sunlit side. */
export const RIM = rimGlsl;
/** Fragment-side varyings written by `sphere.vert.glsl`. */
export const SPHERE_VARYINGS = sphereVaryingsGlsl;
/** Space dust vertex helpers (needs `COMMON` for `sphereShadow`). */
export const DUST_VERTEX = glsl(COMMON, dustVertexGlsl);
/** Film grain: declarations, and the statement that applies it at the end of `main`. */
export const GRAIN_PARS = grainParsGlsl;
export const GRAIN = grainGlsl;

/**
 * Custom shaders for the space scene.
 *
 * Everything is lit by a single directional "Sun" (`uSunDir`, world space, pointing *towards*
 * the Sun). Shadows between bodies (eclipses, ring shadows) are computed analytically against
 * spheres and planes, so there are no shadow maps or extra render passes.
 */
import { NOISE } from "./nebula.ts";
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
 * GLSL helpers
 * ------------------------------------------------------------------------------------------- */

const COMMON = /* glsl */ `
  #define PI 3.141592653589793

  // Distances along a ray to the near/far intersections with a sphere at the origin.
  // Returns (1e9, -1e9) on a miss.
  vec2 raySphere(vec3 origin, vec3 dir, float radius) {
    float b = dot(origin, dir);
    float c = dot(origin, origin) - radius * radius;
    float d = b * b - c;
    if (d < 0.0) return vec2(1e9, -1e9);
    d = sqrt(d);
    return vec2(-b - d, -b + d);
  }

  // Fraction of sunlight reaching \`p\` past an occluding sphere (xyz = centre, w = radius),
  // with a penumbra that widens with distance like a real one.
  float sphereShadow(vec3 p, vec3 sunDir, vec4 sphere) {
    vec3 toCentre = sphere.xyz - p;
    float along = dot(toCentre, sunDir);
    if (along <= 0.0) return 1.0;
    float miss = length(toCentre - sunDir * along);
    // Wider than a real penumbra: distances here are compressed, so a real one looks too hard.
    float penumbra = 0.08 * sphere.w + along * 0.03;
    return smoothstep(sphere.w - penumbra, sphere.w + penumbra, miss);
  }

  // Object-space normal on a UV sphere perturbed by a tangent-space normal.
  vec3 perturbSphereNormal(vec3 n, vec3 tangentNormal) {
    vec3 t = cross(vec3(0.0, 1.0, 0.0), n);
    float len = length(t);
    t = len > 1e-5 ? t / len : vec3(1.0, 0.0, 0.0);
    vec3 b = cross(n, t);
    return normalize(t * tangentNormal.x + b * tangentNormal.y + n * tangentNormal.z);
  }

  float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

const OUTPUT = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

const SPHERE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vObjNormal;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  void main() {
    vUv = uv;
    vObjNormal = normal;
    vWorldNormal = normalize(transpose(inverse(mat3(modelMatrix))) * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const SPHERE_VARYINGS = /* glsl */ `
  uniform mat4 modelMatrix;
  varying vec2 vUv;
  varying vec3 vObjNormal;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
`;

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
      uCloudOffset: { value: 0 },
      uNormalStrength: { value: 1.6 },
      uOccluder: occluder,
    },
    vertexShader: SPHERE_VERTEX,
    fragmentShader: /* glsl */ `
      ${COMMON}
      ${SPHERE_VARYINGS}
      uniform sampler2D uDay;
      uniform sampler2D uNight;
      uniform sampler2D uNormal;
      uniform sampler2D uSpecular;
      uniform sampler2D uClouds;
      uniform float uCloudOffset;
      uniform float uNormalStrength;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec4 uOccluder;

      void main() {
        vec3 L = uSunDir;
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 geoN = normalize(vWorldNormal);

        // Terrain relief from the normal map (oceans are flat).
        vec3 tangentNormal = texture2D(uNormal, vUv).xyz * 2.0 - 1.0;
        tangentNormal.xy *= uNormalStrength;
        vec3 N = normalize(mat3(modelMatrix) * perturbSphereNormal(normalize(vObjNormal), tangentNormal));

        float geoNdL = dot(geoN, L);
        float NdL = max(dot(N, L), 0.0);
        // Smooth the terminator so relief can't light up on the night side.
        float dayMask = smoothstep(-0.05, 0.12, geoNdL);

        // Slightly deepen the satellite mosaic: darker oceans, deserts that don't clip.
        vec3 albedo = pow(texture2D(uDay, vUv).rgb, vec3(1.15)) * 0.85;
        float ocean = texture2D(uSpecular, vUv).r;
        float cloud = texture2D(uClouds, vUv + vec2(uCloudOffset, 0.0)).r;

        // Clouds cast soft shadows; the Moon can eclipse the Sun.
        float shadow = (1.0 - 0.55 * cloud) * mix(0.15, 1.0, sphereShadow(vWorldPos, L, uOccluder));

        // Reddened, dimmer light near the terminator (sunlight through more atmosphere).
        vec3 sunTint = mix(vec3(1.0, 0.62, 0.42), vec3(1.0), smoothstep(0.0, 0.35, geoNdL));
        vec3 light = uSunColor * sunTint * shadow;

        vec3 color = albedo * light * NdL * dayMask;

        // Ocean: sharp sun glint plus a broad sheen, stronger at grazing angles (Fresnel).
        vec3 H = normalize(L + V);
        float NdH = max(dot(geoN, H), 0.0);
        float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
        float glint = pow(NdH, 180.0) * 3.0 + pow(NdH, 18.0) * 0.12;
        color += ocean * light * glint * (0.35 + fresnel) * smoothstep(0.0, 0.1, geoNdL) * (1.0 - cloud);

        // City lights on the night side, hidden under clouds.
        float night = 1.0 - smoothstep(-0.2, 0.08, geoNdL);
        vec3 lights = texture2D(uNight, vUv).rgb;
        color += lights * vec3(1.0, 0.82, 0.6) * 1.4 * night * (1.0 - 0.8 * cloud);

        // Faint earthshine / ambient so the night side is never pure black.
        color += albedo * vec3(0.012, 0.016, 0.024);

        gl_FragColor = vec4(color, 1.0);
        ${OUTPUT}
      }
    `,
  });

export const createCloudMaterial = (
  clouds: Texture,
  lighting: LightingUniforms,
  occluder: { value: Vector4 },
): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: { ...lighting, uClouds: { value: clouds }, uOccluder: occluder },
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    vertexShader: SPHERE_VERTEX,
    fragmentShader: /* glsl */ `
      ${COMMON}
      ${SPHERE_VARYINGS}
      uniform sampler2D uClouds;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec4 uOccluder;

      void main() {
        float density = texture2D(uClouds, vUv).r;
        vec3 N = normalize(vWorldNormal);
        float NdL = dot(N, uSunDir);

        // Wrapped diffuse: clouds scatter light a little past the terminator.
        float lit = clamp((NdL + 0.18) / 1.18, 0.0, 1.0);
        vec3 tint = mix(vec3(1.0, 0.55, 0.35), vec3(1.0), smoothstep(-0.05, 0.3, NdL));
        float shadow = sphereShadow(vWorldPos, uSunDir, uOccluder);

        vec3 color = uSunColor * tint * lit * shadow * 0.85 + vec3(0.006, 0.008, 0.014);
        gl_FragColor = vec4(color, density * 0.95);
        ${OUTPUT}
      }
    `,
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
    defines: { PRIMARY_STEPS: 14, LIGHT_STEPS: 4 },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON}
      varying vec3 vWorldPos;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uCenter;
      uniform float uPlanetRadius;
      uniform float uAtmosphereRadius;
      uniform float uIntensity;

      // Scale heights (fraction of planet radius) and scattering coefficients (per radius).
      const float H_R = 0.0052;
      const float H_M = 0.0016;
      const vec3 BETA_R = vec3(8.9, 20.8, 51.0);
      const float BETA_M = 15.0;
      const float MIE_G = 0.76;

      void main() {
        vec3 origin = (cameraPosition - uCenter) / uPlanetRadius;
        vec3 dir = normalize(vWorldPos - cameraPosition);
        vec3 L = uSunDir;

        vec2 atmo = raySphere(origin, dir, uAtmosphereRadius);
        vec2 ground = raySphere(origin, dir, 1.0);
        float start = max(atmo.x, 0.0);
        float end = ground.x > 0.0 ? min(atmo.y, ground.x) : atmo.y;
        if (end <= start) discard;

        float stepSize = (end - start) / float(PRIMARY_STEPS);
        vec3 sumR = vec3(0.0);
        vec3 sumM = vec3(0.0);
        float depthR = 0.0;
        float depthM = 0.0;

        for (int i = 0; i < PRIMARY_STEPS; i++) {
          vec3 p = origin + dir * (start + stepSize * (float(i) + 0.5));
          float height = length(p) - 1.0;
          float densityR = exp(-height / H_R) * stepSize;
          float densityM = exp(-height / H_M) * stepSize;
          depthR += densityR;
          depthM += densityM;

          // Soft planet shadow: how far the sun ray dips below the surface.
          float along = dot(p, L);
          float closest = length(p - L * along);
          float sunlit = along > 0.0 ? 1.0 : smoothstep(0.985, 1.003, closest);
          if (sunlit <= 0.0) continue;

          float lightStep = raySphere(p, L, uAtmosphereRadius).y / float(LIGHT_STEPS);
          float lightR = 0.0;
          float lightM = 0.0;
          for (int j = 0; j < LIGHT_STEPS; j++) {
            float h = length(p + L * (lightStep * (float(j) + 0.5))) - 1.0;
            lightR += exp(-max(h, 0.0) / H_R) * lightStep;
            lightM += exp(-max(h, 0.0) / H_M) * lightStep;
          }

          vec3 attenuation = exp(-(BETA_R * (depthR + lightR) + BETA_M * 1.1 * (depthM + lightM)));
          sumR += densityR * attenuation * sunlit;
          sumM += densityM * attenuation * sunlit;
        }

        float mu = dot(dir, L);
        float phaseR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
        float g2 = MIE_G * MIE_G;
        float phaseM = 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + mu * mu))
          / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * MIE_G * mu, 1.5));

        vec3 color = uIntensity * uSunColor * (sumR * BETA_R * phaseR + sumM * BETA_M * phaseM);
        // Keep the haze over the disc subtle so surface detail stays crisp; the limb keeps full glow.
        if (ground.x > 0.0) color *= 0.4;
        gl_FragColor = vec4(color, 1.0);
        ${OUTPUT}
      }
    `,
  });

/* ---------------------------------------------------------------------------------------------
 * Planets and moons
 * ------------------------------------------------------------------------------------------- */

/**
 * Thin-atmosphere glow at the limb of the sunlit side (cheap stand-in for real scattering on
 * bodies that are only ever a few hundred pixels across).
 */
const RIM = /* glsl */ `
  vec3 atmosphereRim(vec3 N, vec3 V, vec3 L, vec3 rimColor) {
    float edge = pow(1.0 - max(dot(N, V), 0.0), 4.0);
    return rimColor * edge * smoothstep(-0.25, 0.35, dot(N, L));
  }
`;

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
      uBump: { value: bump },
      uOccluder: occluder,
      uAmbient: { value: ambient },
      uRim: { value: rim },
    },
    vertexShader: SPHERE_VERTEX,
    fragmentShader: /* glsl */ `
      ${COMMON}
      ${RIM}
      ${SPHERE_VARYINGS}
      uniform sampler2D uMap;
      uniform float uBump;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec4 uOccluder;
      uniform vec3 uAmbient;
      uniform vec3 uRim;

      void main() {
        vec3 albedo = texture2D(uMap, vUv).rgb;

        // Bump from the albedo's luminance gradient: craters and ridges catch the light.
        // Measured from the texture itself, so it stays right when a preview is swapped out.
        vec2 texel = 1.0 / vec2(textureSize(uMap, 0));
        vec2 dx = vec2(texel.x * 1.5, 0.0);
        vec2 dy = vec2(0.0, texel.y * 1.5);
        float gx = lum(texture2D(uMap, vUv + dx).rgb) - lum(texture2D(uMap, vUv - dx).rgb);
        float gy = lum(texture2D(uMap, vUv + dy).rgb) - lum(texture2D(uMap, vUv - dy).rgb);
        vec3 tangentNormal = normalize(vec3(-gx * uBump, -gy * uBump, 1.0));
        vec3 N = normalize(mat3(modelMatrix) * perturbSphereNormal(normalize(vObjNormal), tangentNormal));
        vec3 geoN = normalize(vWorldNormal);
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 L = uSunDir;

        // Regolith reflects light back towards the source (Lommel–Seeliger), so a full Moon
        // looks evenly bright instead of fading to the limb like a Lambertian sphere.
        float mu0 = max(dot(N, L), 0.0);
        float mu = max(dot(geoN, V), 0.0);
        float lommel = 2.0 * mu0 / (mu0 + mu + 0.1);
        float lit = mix(mu0, lommel, 0.55) * smoothstep(-0.02, 0.06, dot(geoN, L));

        // Eclipse: an umbra tinted red by sunsets around the occluding planet's rim.
        float shadow = uOccluder.w > 0.0 ? sphereShadow(vWorldPos, L, uOccluder) : 1.0;
        vec3 eclipse = mix(vec3(0.22, 0.06, 0.02), vec3(1.0), shadow);

        vec3 color = albedo * uSunColor * lit * eclipse;
        color += albedo * uAmbient;
        color += atmosphereRim(geoN, V, L, uRim) * uSunColor;
        gl_FragColor = vec4(color, 1.0);
        ${OUTPUT}
      }
    `,
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
}

/** Planets whose visible surface is cloud tops: Venus and the giants. */
export const createCloudyPlanetMaterial = (
  map: Texture,
  lighting: LightingUniforms,
  { ring, rim = new Color(0, 0, 0), limbDarkening = 0.35 }: CloudyPlanetOptions = {},
): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: {
      ...lighting,
      ...ring,
      uMap: { value: map },
      uRim: { value: rim },
      uLimbDarkening: { value: limbDarkening },
    },
    defines: ring ? { HAS_RING: "" } : {},
    vertexShader: SPHERE_VERTEX,
    fragmentShader: /* glsl */ `
      ${COMMON}
      ${RIM}
      ${SPHERE_VARYINGS}
      uniform sampler2D uMap;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uRim;
      uniform float uLimbDarkening;
      #ifdef HAS_RING
        uniform sampler2D uRing;
        uniform vec3 uRingNormal;
        uniform vec3 uRingCenter;
        uniform vec2 uRingRadii;
      #endif

      void main() {
        vec3 albedo = texture2D(uMap, vUv).rgb;
        vec3 N = normalize(vWorldNormal);
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 L = uSunDir;
        float NdL = max(dot(N, L), 0.0);

        float shadow = 1.0;
        #ifdef HAS_RING
          // Shadow of the rings: follow the sun ray to the ring plane and look up its opacity.
          float denom = dot(L, uRingNormal);
          if (abs(denom) > 1e-4) {
            float t = dot(uRingCenter - vWorldPos, uRingNormal) / denom;
            if (t > 0.0) {
              float r = length(vWorldPos + L * t - uRingCenter);
              float x = (r - uRingRadii.x) / (uRingRadii.y - uRingRadii.x);
              if (x > 0.0 && x < 1.0) shadow = 1.0 - 0.9 * texture2D(uRing, vec2(x, 0.5)).a;
            }
          }
        #endif

        // Hazy upper atmosphere: limb darkening and a soft terminator.
        float limb = mix(1.0 - uLimbDarkening, 1.0, pow(max(dot(N, V), 0.0), 0.35));
        float lit = smoothstep(-0.08, 0.25, dot(N, L)) * mix(NdL, 1.0, 0.15);

        vec3 color = albedo * uSunColor * lit * limb * shadow + albedo * 0.006;
        color += atmosphereRim(N, V, L, uRim) * uSunColor;
        gl_FragColor = vec4(color, 1.0);
        ${OUTPUT}
      }
    `,
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
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON}
      varying vec3 vWorldPos;
      uniform sampler2D uRing;
      uniform vec3 uRingNormal;
      uniform vec3 uRingCenter;
      uniform vec2 uRingRadii;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec4 uPlanet;

      void main() {
        float r = length(vWorldPos - uRingCenter);
        float x = (r - uRingRadii.x) / (uRingRadii.y - uRingRadii.x);
        if (x < 0.0 || x > 1.0) discard;
        vec4 ring = texture2D(uRing, vec2(x, 0.5));

        vec3 L = uSunDir;
        vec3 V = normalize(cameraPosition - vWorldPos);
        float sunSide = dot(uRingNormal, L);
        float viewSide = dot(uRingNormal, V);

        // Lit face reflects; the unlit face only glows where sunlight diffuses through gaps.
        float incidence = min(abs(sunSide) * 4.0, 1.0);
        float brightness = sunSide * viewSide > 0.0
          ? 0.4 + 0.6 * incidence
          : (1.0 - ring.a) * 1.2 * incidence;

        // Icy particles scatter strongly forward when backlit.
        float forward = pow(max(dot(-V, L), 0.0), 6.0);
        brightness *= 1.0 + 2.5 * forward;

        float shadow = sphereShadow(vWorldPos, L, vec4(uPlanet.xyz, uPlanet.w * 0.995));
        shadow = mix(0.04, 1.0, shadow);

        vec3 color = ring.rgb * uSunColor * brightness * shadow;
        gl_FragColor = vec4(color, ring.a * 0.95);
        ${OUTPUT}
      }
    `,
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
    depthWrite: false,
    depthTest: false,
    vertexShader: /* glsl */ `
      varying vec3 vLocalDir;
      varying vec3 vWorldDir;
      void main() {
        vLocalDir = position;
        vWorldDir = mat3(modelMatrix) * position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON}
      varying vec3 vLocalDir;
      varying vec3 vWorldDir;
      uniform sampler2D uMilkyWay;
      uniform sampler2D uNebula;
      uniform float uNebulaRange;
      uniform float uExposure;
      uniform float uSunAngularRadius;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;

      void main() {
        vec3 local = normalize(vLocalDir);
        vec2 uv = vec2(atan(local.z, local.x) / (2.0 * PI) + 0.5, asin(clamp(local.y, -1.0, 1.0)) / PI + 0.5);
        vec3 galaxy = texture2D(uMilkyWay, uv).rgb;
        // Lift the faint nebulosity a touch more than the background so the band reads.
        galaxy = galaxy * uExposure * (1.0 + 1.5 * smoothstep(0.0, 0.08, lum(galaxy)));
        // Baked nebulae (stored square-rooted; see nebula.ts).
        vec3 nebula = texture2D(uNebula, uv).rgb;
        galaxy += nebula * nebula * uNebulaRange;

        vec3 dir = normalize(vWorldDir);
        float angle = acos(clamp(dot(dir, uSunDir), -1.0, 1.0));

        // The Sun's glare washes out the faint sky around it.
        galaxy *= 1.0 - 0.9 * exp(-angle * 3.0);

        float disc = smoothstep(uSunAngularRadius * 1.08, uSunAngularRadius * 0.92, angle);
        float corona = exp(-angle * 55.0) * 2.5 + exp(-angle * 9.0) * 0.35 + exp(-angle * 2.2) * 0.04;
        vec3 sun = vec3(1.0, 0.96, 0.9) * disc * 60.0 + uSunColor * vec3(1.0, 0.9, 0.75) * corona;

        gl_FragColor = vec4(galaxy + sun, 1.0);
        ${OUTPUT}
      }
    `,
  });

export const createStarMaterial = (lighting: LightingUniforms): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: { ...lighting, uPixelRatio: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aSize;
      uniform float uPixelRatio;
      uniform vec3 uSunDir;
      varying vec3 vColor;

      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        // Stars vanish in the Sun's glare.
        float sunAngle = dot(normalize(mat3(modelMatrix) * position), uSunDir);
        vColor = aColor * (1.0 - smoothstep(0.85, 0.99, sunAngle));
        gl_PointSize = aSize * uPixelRatio;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float falloff = exp(-dot(c, c) * 18.0);
        if (falloff < 0.01) discard;
        gl_FragColor = vec4(vColor * falloff, 1.0);
        ${OUTPUT}
      }
    `,
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
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uShift;
      uniform float uHalfLength;
      varying vec3 vNormal;
      varying vec3 vTint;

      // Rotation about a unit axis (Rodrigues).
      mat3 rotation(vec3 axis, float angle) {
        float c = cos(angle);
        float s = sin(angle);
        vec3 a = axis * (1.0 - c);
        return mat3(
          a.x * axis.x + c, a.y * axis.x + s * axis.z, a.z * axis.x - s * axis.y,
          a.x * axis.y - s * axis.z, a.y * axis.y + c, a.z * axis.y + s * axis.x,
          a.x * axis.z + s * axis.y, a.y * axis.z - s * axis.x, a.z * axis.z + c);
      }

      void main() {
        // Each rock tumbles about its own axis at its own rate, seeded by where it sits.
        vec3 seed = fract(instanceMatrix[3].xyz * vec3(0.1031, 0.1137, 0.0973));
        seed += dot(seed, seed.yzx + 33.33);
        seed = fract((seed.xxy + seed.yzz) * seed.zyx);
        vec3 axis = normalize(seed - 0.5 + 1e-3);
        float rate = mix(0.05, 0.7, seed.x) * (seed.y > 0.5 ? 1.0 : -1.0);
        mat3 spin = rotation(axis, uTime * rate);

        // Drift along the band, wrapping round; shrink to nothing near the ends.
        mat4 instance = instanceMatrix;
        float along = mod(instance[3].x + uShift + uHalfLength, 2.0 * uHalfLength) - uHalfLength;
        instance[3].x = along;
        float fade = 1.0 - smoothstep(0.7 * uHalfLength, uHalfLength, abs(along));

        mat4 model = modelMatrix * instance;
        vNormal = normalize(mat3(model) * (spin * normal));
        #ifdef USE_INSTANCING_COLOR
          vTint = instanceColor;
        #else
          vTint = vec3(0.4);
        #endif
        gl_Position = projectionMatrix * viewMatrix * model * vec4(spin * position * fade, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vTint;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      void main() {
        float NdL = max(dot(normalize(vNormal), uSunDir), 0.0);
        vec3 color = vTint * (uSunColor * NdL + vec3(0.01, 0.012, 0.016));
        gl_FragColor = vec4(color, 1.0);
        ${OUTPUT}
      }
    `,
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
    vertexShader: /* glsl */ `
      attribute vec2 aTail; // x: 0 at the head → 1 at the tip, y: -1 → 1 across
      uniform vec3 uHead;
      uniform vec3 uAxis;
      uniform vec3 uCurve;
      uniform float uLength;
      uniform float uWidth;
      uniform float uActivity;
      varying vec2 vTail;

      void main() {
        float s = aTail.x;
        float length = uLength * (0.35 + 0.65 * uActivity);
        vec3 spine = uHead + (uAxis * s + uCurve * s * s) * length;
        vec3 tangent = normalize(uAxis + 2.0 * s * uCurve);
        // Seen straight down the tail the cross product vanishes; any perpendicular will do.
        vec3 across = cross(tangent, normalize(cameraPosition - spine));
        // ("length" is a local variable here, hiding the built-in function.)
        float acrossLength = sqrt(dot(across, across));
        vec3 side = acrossLength > 1e-5
          ? across / acrossLength
          : normalize(cross(tangent, abs(tangent.z) < 0.9 ? vec3(0, 0, 1) : vec3(1, 0, 0)));
        float halfWidth = uWidth * (0.08 + 0.92 * sqrt(s));
        vTail = aTail;
        gl_Position = projectionMatrix * viewMatrix * vec4(spine + side * aTail.y * halfWidth, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      uniform float uStreamers;
      uniform float uTime;
      uniform float uActivity;
      varying vec2 vTail;

      void main() {
        float s = vTail.x;
        float across = exp(-vTail.y * vTail.y * 4.0);
        // Clamped: interpolation can push s a hair past 1, and pow() of a negative is NaN.
        float along = pow(max(1.0 - s, 0.0), 1.6) * smoothstep(0.0, 0.04, s);
        // Slowly shifting streamers that grow out of the smooth coma.
        float wave = sin(vTail.y * 23.0 + s * 9.0 - uTime * 0.3) * sin(vTail.y * 7.0 - uTime * 0.11);
        float rays = max(1.0 + uStreamers * wave * smoothstep(0.05, 0.4, s), 0.0);
        gl_FragColor = vec4(uColor * uIntensity * uActivity * across * along * rays, 1.0);
        ${OUTPUT}
      }
    `,
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
    vertexShader: /* glsl */ `
      uniform vec3 uHead;
      uniform float uSize;
      varying vec2 vOffset;
      void main() {
        vOffset = position.xy;
        vec4 view = viewMatrix * vec4(uHead, 1.0);
        view.xy += position.xy * uSize;
        gl_Position = projectionMatrix * view;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uActivity;
      varying vec2 vOffset;
      void main() {
        float r2 = dot(vOffset, vOffset);
        float glow = exp(-r2 * 6.0) * 0.6 * uActivity + exp(-r2 * 60.0) * (1.0 + 1.5 * uActivity);
        gl_FragColor = vec4(uColor * glow, 1.0);
        ${OUTPUT}
      }
    `,
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
    vertexShader: /* glsl */ `
      attribute vec4 aRandom; // phase, β, size, brightness — all 0..1
      attribute vec3 aDirection; // unit ejection direction
      uniform vec3 uOrbitP;
      uniform vec3 uOrbitQ;
      uniform float uSemiMajorAxis;
      uniform float uEccentricity;
      uniform float uMeanAnomaly;
      uniform float uMeanMotion;
      uniform float uTime;
      uniform float uActivity;
      uniform vec3 uAxis;
      uniform float uPointScale;
      uniform float uLifetime;
      uniform float uPressure;
      uniform float uSpread;
      uniform float uSize;
      uniform float uOrbitLag;
      uniform vec3 uHead;
      varying float vBrightness;

      void main() {
        float age = fract(aRandom.x + uTime / uLifetime) * uLifetime;
        float life = age / uLifetime;

        // Where the nucleus was when this grain left it (Kepler's equation, Newton's method).
        float e = uEccentricity;
        float M = uMeanAnomaly - uMeanMotion * age;
        float E = M + e * sin(M);
        for (int i = 0; i < 5; i++) E -= (E - e * sin(E) - M) / (1.0 - e * cos(E));
        float b = uSemiMajorAxis * sqrt(1.0 - e * e);
        vec3 released = uOrbitP * (uSemiMajorAxis * (cos(E) - e)) + uOrbitQ * (b * sin(E));

        // Radiation pressure (stronger on small grains) plus a slow random spread.
        float beta = mix(0.2, 1.0, aRandom.y);
        vec3 position = uHead + (released - uHead) * uOrbitLag
          + uAxis * (0.5 * uPressure * uActivity * beta * age * age)
          + aDirection * (uSpread * age);

        vec4 view = viewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * view;

        // Grains spread out (bigger, fainter) as they age; keep total light constant when the
        // point would be smaller than a pixel so distant tails don't sparkle.
        float worldSize = uSize * mix(0.6, 1.4, aRandom.z) * (1.0 + 1.5 * life);
        float pixels = worldSize * uPointScale / max(-view.z, 1e-3);
        gl_PointSize = clamp(pixels, 1.5, 48.0);
        float coverage = min(1.0, (pixels * pixels) / (gl_PointSize * gl_PointSize));

        vBrightness = pow(1.0 - life, 1.4) * smoothstep(0.0, 0.04, life)
          * mix(0.4, 1.0, aRandom.w) * uActivity * coverage;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      varying float vBrightness;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float falloff = exp(-dot(c, c) * 14.0);
        gl_FragColor = vec4(uColor * uIntensity * vBrightness * falloff, 1.0);
        ${OUTPUT}
      }
    `,
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
}

/** Shared by the dots and the streaks: where a grain is, and how much sunlight it scatters. */
const DUST_VERTEX_COMMON = /* glsl */ `
  ${COMMON}
  uniform vec3 uCameraPos;
  uniform float uTime;
  uniform float uBoxSize;
  uniform float uIntensity;
  uniform vec3 uDrift;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec4 uEarth;

  // Wrap a grain into the box centred on the camera; returns its offset from the camera.
  vec3 dustOffset(vec3 unitPosition) {
    return mod(unitPosition * uBoxSize + uDrift * uTime - uCameraPos, uBoxSize) - 0.5 * uBoxSize;
  }

  // Sunlight scattered towards the camera, faded near the box edge (where grains wrap) and
  // right in front of the lens.
  vec3 dustLight(vec3 offset) {
    float dist = length(offset);
    float fade = (1.0 - smoothstep(0.3 * uBoxSize, 0.5 * uBoxSize, dist)) * smoothstep(0.6, 2.5, dist);
    // Henyey–Greenstein forward scattering (g = 0.6), plus a little back-scatter.
    float cosTheta = dot(offset / max(dist, 1e-3), uSunDir);
    float g = 0.6;
    float phase = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosTheta, 1.5) + 0.3;
    float shadow = sphereShadow(uCameraPos + offset, uSunDir, uEarth);
    return uSunColor * vec3(1.0, 0.93, 0.85) * uIntensity * phase * shadow * fade;
  }
`;

const dustUniforms = (
  dust: SpaceDustUniforms,
  lighting: LightingUniforms,
  { boxSize, size, intensity, drift, streakTime, streakSpeeds }: SpaceDustOptions,
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
    vertexShader: /* glsl */ `
      ${DUST_VERTEX_COMMON}
      attribute vec2 aRandom; // size, brightness — 0..1
      uniform float uPointScale;
      uniform float uSize;
      uniform vec3 uVelocity;
      uniform vec2 uStreakSpeeds;
      varying vec3 vColor;

      void main() {
        vec3 offset = dustOffset(position);
        vec4 view = viewMatrix * vec4(uCameraPos + offset, 1.0);
        gl_Position = projectionMatrix * view;

        // Keep total light constant when a grain is smaller than a pixel, so they don't sparkle.
        float pixels = uSize * mix(0.5, 1.5, aRandom.x) * uPointScale / max(-view.z, 1e-3);
        gl_PointSize = clamp(pixels, 1.0, 3.0);
        float coverage = min(1.0, (pixels * pixels) / (gl_PointSize * gl_PointSize));
        // At speed the light is smeared into a streak instead (see the streak material).
        float streaking = smoothstep(uStreakSpeeds.x, uStreakSpeeds.y, length(uVelocity));

        vColor = dustLight(offset) * coverage * mix(0.3, 1.0, aRandom.y) * (1.0 - 0.7 * streaking);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float falloff = exp(-dot(c, c) * 16.0);
        if (falloff < 0.02) discard;
        gl_FragColor = vec4(vColor * falloff, 1.0);
        ${OUTPUT}
      }
    `,
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
    vertexShader: /* glsl */ `
      ${DUST_VERTEX_COMMON}
      attribute float aEnd;
      attribute vec2 aRandom;
      uniform vec3 uVelocity;
      uniform float uStreakTime;
      uniform vec2 uStreakSpeeds;
      varying vec3 vColor;

      void main() {
        vec3 head = dustOffset(position);
        // The tail is where the grain appeared to be a moment ago, relative to the camera.
        vec3 offset = head + uVelocity * uStreakTime * aEnd;
        gl_Position = projectionMatrix * viewMatrix * vec4(uCameraPos + offset, 1.0);

        float streaking = smoothstep(uStreakSpeeds.x, uStreakSpeeds.y, length(uVelocity));
        vColor = dustLight(head) * streaking * (1.0 - aEnd) * 3.0 * mix(0.3, 1.0, aRandom.y);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        gl_FragColor = vec4(vColor, 1.0);
        ${OUTPUT}
      }
    `,
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
    vertexShader: SPHERE_VERTEX,
    fragmentShader: /* glsl */ `
      ${COMMON}
      ${SPHERE_VARYINGS}
      ${NOISE}
      uniform sampler2D uClouds;
      uniform vec3 uSunDir;
      uniform float uTime;
      uniform float uFlashes;

      // Glow of one auroral oval around \`pole\` (object space), ~20° from it.
      vec3 aurora(vec3 n, vec3 pole, float seed) {
        float theta = acos(clamp(dot(n, pole), -1.0, 1.0));
        vec3 east = normalize(cross(pole, abs(pole.x) < 0.9 ? vec3(1, 0, 0) : vec3(0, 0, 1)));
        float lon = atan(dot(n, cross(pole, east)), dot(n, east));
        // The oval wobbles and pulses slowly.
        float centre = 0.34 + 0.035 * sin(lon * 3.0 + uTime * 0.07 + seed)
          + 0.02 * (fbm(vec3(lon * 2.0, uTime * 0.05, seed)) - 0.5);
        float offset = (theta - centre) / 0.035;
        float band = exp(-offset * offset);
        if (band < 0.01) return vec3(0.0);
        // Vertical curtains: fine streaks along the oval that drift and brighten.
        float curtains = smoothstep(0.35, 0.8, fbm(vec3(lon * 14.0, uTime * 0.12, seed * 3.0)));
        // Green oxygen glow, with red/purple at the poleward edge where the curtains are tallest.
        float poleward = smoothstep(0.0, -0.05, theta - centre);
        vec3 colour = mix(vec3(0.15, 1.0, 0.45), vec3(0.75, 0.2, 0.55), poleward * 0.6);
        return colour * band * (0.25 + curtains);
      }

      void main() {
        vec3 N = normalize(vWorldNormal);
        float night = smoothstep(0.05, -0.2, dot(N, uSunDir));
        if (night <= 0.0) discard;
        vec3 n = normalize(vObjNormal);
        vec3 V = normalize(cameraPosition - vWorldPos);
        // Curtains seen edge-on near the limb look brighter.
        float limb = 0.5 + 1.5 * pow(1.0 - abs(dot(N, V)), 2.0);

        vec3 light = (aurora(n, normalize(vec3(0.08, 1.0, 0.05)), 1.7)
          + aurora(n, normalize(vec3(-0.1, -1.0, 0.07)), 5.3)) * limb * 0.22;

        // Thunderstorms: a sparse grid of cells in the tropics, each flashing now and then.
        vec2 grid = vec2(72.0, 36.0);
        vec2 cell = floor(vUv * grid);
        float h = hash(vec3(cell, 3.7));
        float tropics = 1.0 - smoothstep(0.35, 0.6, abs(n.y));
        if (h < 0.22 && tropics > 0.0 && uFlashes > 0.0) {
          float period = 3.0 + 9.0 * hash(vec3(cell, 9.1));
          float t = mod(uTime + h * 97.0, period);
          float flash = exp(-t * 9.0) * (0.6 + 0.4 * cos(t * 40.0));
          vec2 jitter = vec2(hash(vec3(cell, 1.3)), hash(vec3(cell, 2.9))) - 0.5;
          vec2 local = fract(vUv * grid) - 0.5 - jitter * 0.5;
          float blob = exp(-dot(local, local) * 18.0);
          float cloud = texture2D(uClouds, vUv).r;
          light += vec3(0.75, 0.82, 1.0) * flash * blob * cloud * tropics * 2.5 * uFlashes;
        }

        gl_FragColor = vec4(light * night, 1.0);
        ${OUTPUT}
      }
    `,
  });
